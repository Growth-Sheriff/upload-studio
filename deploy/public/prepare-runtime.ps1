[CmdletBinding()]
param([ValidateSet('Prepare','Deploy')][string]$Phase='Prepare')
$ErrorActionPreference='Stop'
$secretDirectory='C:\Users\mhmmd\.codex\secrets\agsu-public'
$state=Import-Clixml -LiteralPath (Join-Path $secretDirectory 'digitalocean.clixml')
$image='ghcr.io/growth-sheriff/auto-gang-sheet-public@sha256:9c039fc1dc6809006c604ae94b14074c255e0138f890347c813f83c398929d7c'
if ([long]$state.DropletId -ne 607746803 -or $state.PublicIp -ne '143.198.12.234') { throw 'Not the owned NEW public host' }
function Reveal($value) { [System.Net.NetworkCredential]::new('', $value).Password }
function Protect-File([string]$file) {
  $identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $file /inheritance:r /grant:r "${identity}:F" '*S-1-5-18:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Credential ACL restriction failed' }
}
function New-Secret { [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }
function Database-Url($connection) {
  if ($connection.User -notin @('agsu_app','agsu_migrate') -or !$connection.SSL -or $connection.Database -ne 'public_app') { throw 'Unexpected database role/SSL/target' }
  $user=[Uri]::EscapeDataString($connection.User)
  $password=[Uri]::EscapeDataString((Reveal $connection.Password))
  return "postgresql://${user}:${password}@$($connection.Host):$($connection.Port)/public_app?schema=public&sslmode=require&sslaccept=strict&sslcert=/run/secrets/pg-ca.pem&connection_limit=5&pool_timeout=10&connect_timeout=15"
}
$r2Path=Join-Path $secretDirectory 'r2.clixml'
if (!(Test-Path -LiteralPath $r2Path)) {
  $plainPath=Join-Path $secretDirectory 'r2-created.json'
  $created=Get-Content -LiteralPath $plainPath -Raw | ConvertFrom-Json
  if ($created.AccountId -ne '3b964e63af3f0e752c640e35dab68c9b' -or $created.Bucket -ne 'auto-gang-sheet-public' -or $created.Name -ne 'agsu-public-runtime-20261010') { throw 'Unexpected new R2 credential scope' }
  @{AccountId=$created.AccountId;Bucket=$created.Bucket;Name=$created.Name;CreatedAt=$created.CreatedAt;AccessKeyId=($created.AccessKeyId|ConvertTo-SecureString -AsPlainText -Force);SecretAccessKey=($created.SecretAccessKey|ConvertTo-SecureString -AsPlainText -Force)} | Export-Clixml -LiteralPath $r2Path
  Protect-File $r2Path
  # Exact disposable plaintext artifact created by the approved R2 UI operation.
  if ([IO.Path]::GetFullPath($plainPath) -ne 'C:\Users\mhmmd\.codex\secrets\agsu-public\r2-created.json') { throw 'Unexpected plaintext cleanup target' }
  Remove-Item -LiteralPath $plainPath
}
$r2=Import-Clixml -LiteralPath $r2Path
if ($r2.AccountId -ne '3b964e63af3f0e752c640e35dab68c9b' -or $r2.Bucket -ne 'auto-gang-sheet-public' -or $r2.Name -ne 'agsu-public-runtime-20261010') { throw 'Stored credential is not the approved new R2 bucket credential' }
$shopify=@{}
foreach($line in (Get-Content -LiteralPath (Join-Path $secretDirectory 'shopify.env'))) {
  if($line -match '^([A-Z_]+)=(.*)$') { $shopify[$Matches[1]]=$Matches[2].Trim('"').Trim("'") }
}
if($shopify.SHOPIFY_API_KEY -ne '8822c01b1f0be2280240cfab7d4e9a79' -or !$shopify.SHOPIFY_API_SECRET) { throw 'Not the verified Actual Scope app' }
$runtimePath=Join-Path $secretDirectory 'runtime.clixml'
if(!(Test-Path -LiteralPath $runtimePath)) {
  @{CapabilitySecret=((New-Secret)|ConvertTo-SecureString -AsPlainText -Force);OperationsSecret=((New-Secret)|ConvertTo-SecureString -AsPlainText -Force)} | Export-Clixml -LiteralPath $runtimePath
  Protect-File $runtimePath
}
$runtime=Import-Clixml -LiteralPath $runtimePath
if(!$state.QueuePrivate.SSL) { throw 'Valkey TLS is required' }
$queueUser=[Uri]::EscapeDataString($state.QueuePrivate.User)
$queuePassword=[Uri]::EscapeDataString((Reveal $state.QueuePrivate.Password))
$environment=[ordered]@{
  PUBLIC_IMAGE=$image;NODE_ENV='production';PUBLIC_APP_RUNTIME='true';STRICT_TENANT_GUARD='true';PORT='3000'
  SHOPIFY_APP_URL='https://auto-gang-sheet.actualscope.com';SHOPIFY_API_KEY=$shopify.SHOPIFY_API_KEY;SHOPIFY_API_SECRET=$shopify.SHOPIFY_API_SECRET;SCOPES=$shopify.SCOPES
  DATABASE_URL=(Database-Url $state.PgRuntime);REDIS_URL="rediss://${queueUser}:${queuePassword}@$($state.QueuePrivate.Host):$($state.QueuePrivate.Port)/0"
  SECRET_KEY=(Reveal $runtime.CapabilitySecret);PUBLIC_OPERATIONS_TOKEN=(Reveal $runtime.OperationsSecret)
  DEFAULT_STORAGE_PROVIDER='r2';R2_ACCOUNT_ID=$r2.AccountId;R2_ACCESS_KEY_ID=(Reveal $r2.AccessKeyId);R2_SECRET_ACCESS_KEY=(Reveal $r2.SecretAccessKey);R2_BUCKET_NAME=$r2.Bucket;R2_PUBLIC_URL=''
  MEASURE_WORKER_CONCURRENCY='1';PREVIEW_WORKER_CONCURRENCY='1';MEASURE_JOB_BUDGET_MS='300000';PREVIEW_JOB_BUDGET_MS='180000'
}
$envPath=Join-Path $secretDirectory 'public.env'
[IO.File]::WriteAllLines($envPath,@($environment.GetEnumerator()|ForEach-Object {"$($_.Key)=$($_.Value)"}),[Text.UTF8Encoding]::new($false))
Protect-File $envPath
$migrationPath=Join-Path $secretDirectory 'migration.env'
[IO.File]::WriteAllLines($migrationPath,@('DATABASE_URL='+(Database-Url $state.PgMigration)),[Text.UTF8Encoding]::new($false))
Protect-File $migrationPath
Write-Output 'Prepared private new-app environment and encrypted R2 credentials; no values logged.'
if($Phase -ne 'Deploy') { return }
$sshOptions=@('-i',(Join-Path $secretDirectory 'id_ed25519'),'-o',('UserKnownHostsFile='+(Join-Path $secretDirectory 'known_hosts')),'-o','StrictHostKeyChecking=yes','-o','BatchMode=yes')
$target='root@143.198.12.234'
$hostId=& ssh.exe @sshOptions $target 'curl --fail --silent http://169.254.169.254/metadata/v1/id'
if($LASTEXITCODE -ne 0 -or "$hostId".Trim() -ne '607746803') { throw 'Remote target is not the NEW owned public droplet' }
$inventory=Get-Content -LiteralPath 'C:\Users\mhmmd\Desktop\credentials-envanteri.json' -Raw | ConvertFrom-Json
$registryToken=$inventory.gsb_ops.github.token
$registryIdentity=Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers @{Authorization="Bearer $registryToken";'X-GitHub-Api-Version'='2022-11-28';'User-Agent'='agsu-public-release'}
if($registryIdentity.login -ne 'jesuisfatih') { throw 'Unexpected registry account' }
$registryToken | & ssh.exe @sshOptions $target 'docker login ghcr.io --username jesuisfatih --password-stdin >/dev/null 2>&1'
if($LASTEXITCODE -ne 0) { throw 'Private public-image registry login failed' }
foreach($file in @($envPath,$migrationPath,(Join-Path $secretDirectory 'pg-ca.pem'))) {
  & scp.exe @sshOptions $file ($target+':/opt/agsu-public/')
  if($LASTEXITCODE -ne 0) { throw 'New-host private configuration transfer failed' }
}
& scp.exe @sshOptions (Join-Path $PSScriptRoot 'compose.yml') ($target+':/opt/agsu-public/compose.yml')
if($LASTEXITCODE -ne 0) { throw 'New-host compose transfer failed' }
& ssh.exe @sshOptions $target "chmod 600 /opt/agsu-public/public.env /opt/agsu-public/migration.env; chmod 644 /opt/agsu-public/pg-ca.pem; docker pull $image"
if($LASTEXITCODE -ne 0) { throw 'Public image pull failed' }
& ssh.exe @sshOptions $target "docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --memory 512m --pids-limit 64 --tmpfs /tmp:rw,nosuid,nodev,size=256m --env-file /opt/agsu-public/migration.env -v /opt/agsu-public/pg-ca.pem:/run/secrets/pg-ca.pem:ro $image node node_modules/prisma/build/index.js migrate deploy"
if($LASTEXITCODE -ne 0) { throw 'New database migration failed; application was not started' }
& ssh.exe @sshOptions $target 'docker compose --env-file /opt/agsu-public/public.env -f /opt/agsu-public/compose.yml up -d'
if($LASTEXITCODE -ne 0) { throw 'New public app startup failed; inspect exact owned services' }
& ssh.exe @sshOptions $target 'docker compose --env-file /opt/agsu-public/public.env -f /opt/agsu-public/compose.yml ps'
