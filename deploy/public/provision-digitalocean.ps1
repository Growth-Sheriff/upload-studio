[CmdletBinding()]
param(
  [ValidateSet('Create', 'Status', 'Finish', 'DatabaseRoles')][string]$Phase = 'Status',
  [string]$InventoryPath = 'C:\Users\mhmmd\Desktop\credentials-envanteri.json',
  [string]$SecretDirectory = 'C:\Users\mhmmd\.codex\secrets\agsu-public'
)
$ErrorActionPreference = 'Stop'
$protectedDroplets = @(595418413, 595439459, 595444296, 595444301, 595444304, 601821519, 605822854)
$expectedAccount = 'mhmmdadgzl@outlook.com'
$region = 'nyc3'
$inventory = Get-Content -LiteralPath $InventoryPath -Raw | ConvertFrom-Json
$headers = @{ Authorization = 'Bearer ' + $inventory.gsb_ops.digitalocean_doctl.access_token }
function Invoke-DO([string]$Method, [string]$Resource, $Body = $null) {
  $request = @{ Method=$Method; Uri=('https://api.digitalocean.com/v2/' + $Resource); Headers=$headers; TimeoutSec=40 }
  if ($null -ne $Body) { $request.ContentType='application/json'; $request.Body=$Body | ConvertTo-Json -Depth 12 -Compress }
  try { Invoke-RestMethod @request } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'network-error' }
    throw "DigitalOcean $Method $Resource failed ($status). Inspect provider metadata before retrying; no raw response/secret is logged."
  }
}
function Protect-Path([string]$Path) {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $grant = if ((Get-Item -LiteralPath $Path).PSIsContainer) { '(OI)(CI)F' } else { 'F' }
  & icacls.exe $Path /inheritance:r /grant:r "${identity}:$grant" '*S-1-5-18:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not restrict credentials ACL' }
}
if ([IO.Path]::GetFullPath($SecretDirectory) -ne 'C:\Users\mhmmd\.codex\secrets\agsu-public') { throw 'Unexpected secret directory' }
if (!(Test-Path -LiteralPath $SecretDirectory)) { New-Item -ItemType Directory -Path $SecretDirectory | Out-Null }
Protect-Path $SecretDirectory
$statePath = Join-Path $SecretDirectory 'digitalocean.clixml'
$state = if (Test-Path -LiteralPath $statePath) { Import-Clixml -LiteralPath $statePath } else { @{} }
function Save-State { $state | Export-Clixml -LiteralPath $statePath; Protect-Path $statePath }
$account = (Invoke-DO GET 'account').account
if ($account.email -ne $expectedAccount -or $account.status -ne 'active') { throw 'Unexpected or inactive DigitalOcean account' }
function Assert-NewDroplet {
  if (!$state.DropletId -or $protectedDroplets -contains [long]$state.DropletId) { throw 'Target is missing or protected' }
  $droplet = (Invoke-DO GET ('droplets/' + $state.DropletId)).droplet
  if ($droplet.name -ne 'agsu-public-web' -or $droplet.region.slug -ne $region -or $droplet.vpc_uuid -ne $state.VpcId -or $droplet.created_at -ne $state.DropletCreatedAt) { throw 'New host ownership mismatch' }
  return $droplet
}
function Assert-NewDatabase([string]$Id, [string]$Name, [string]$Engine) {
  $database = (Invoke-DO GET ('databases/' + $Id)).database
  if ($database.name -ne $Name -or $database.engine -ne $Engine -or $database.region -ne $region -or $database.private_network_uuid -ne $state.VpcId) { throw 'New database ownership mismatch' }
  return $database
}
function Invoke-NewHostPsql([string]$Action, $Connection) {
  $droplet = Assert-NewDroplet
  $newIp = @($droplet.networks.v4 | Where-Object {$_.type -eq 'public'})[0].ip_address
  if ($newIp -ne '143.198.12.234' -or [long]$droplet.id -ne 607746803) { throw 'SQL helper is pinned to the new public host' }
  $password = [System.Net.NetworkCredential]::new('', $Connection.Password).Password
  $escapedPassword = $password.Replace('\', '\\').Replace(':', '\:')
  $passLine = '{0}:{1}:public_app:{2}:{3}' -f $Connection.Host, $Connection.Port, $Connection.User, $escapedPassword
  # Password goes over SSH stdin, never command-line/environment/log output.
  $start = [Diagnostics.ProcessStartInfo]::new('ssh.exe')
  $start.UseShellExecute=$false; $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
  foreach ($argument in @('-i',(Join-Path $SecretDirectory 'id_ed25519'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o',('UserKnownHostsFile='+(Join-Path $SecretDirectory 'known_hosts')),'-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',('root@'+$newIp),('bash /opt/agsu-public/bootstrap-postgres.sh '+$Action+' '+$Connection.Host+' '+$Connection.Port+' '+$Connection.User))) { $start.ArgumentList.Add([string]$argument) }
  $process=[Diagnostics.Process]::Start($start)
  $process.StandardInput.WriteLine($passLine); $process.StandardInput.Close()
  $stdout=$process.StandardOutput.ReadToEnd(); $stderr=$process.StandardError.ReadToEnd(); $process.WaitForExit()
  $password=$null; $passLine=$null; $escapedPassword=$null
  if($process.ExitCode -ne 0) { throw ('New public database setup failed: '+$stderr) }
  $stdout.Trim()
}
if ($Phase -eq 'Create') {
  $collections = @{ ProjectId='projects'; VpcId='vpcs'; DropletId='droplets'; PgId='databases'; QueueId='databases' }
  $names = @{ ProjectId='agsu-public'; VpcId='agsu-public-vpc'; DropletId='agsu-public-web'; PgId='agsu-public-pg'; QueueId='agsu-public-queue' }
  foreach ($key in $collections.Keys) {
    if ($state[$key]) { continue }
    $collection = $collections[$key]
    $found = @((Invoke-DO GET ($collection + '?per_page=200')).$collection | Where-Object { $_.name -eq $names[$key] })
    if ($found.Count) { throw "Name $($names[$key]) already exists without owned state. Recover its identity explicitly; never adopt/duplicate it." }
  }
  if (!$state.ProjectId) {
    $project = (Invoke-DO POST 'projects' @{ name='agsu-public'; description='Isolated Auto Gang Sheet Upload public-app demo/review; never custom tenants'; purpose='Web Application'; environment='Development' }).project
    $state.ProjectId=$project.id; Save-State
  }
  if (!$state.VpcId) {
    $vpc = (Invoke-DO POST 'vpcs' @{ name='agsu-public-vpc'; region=$region; description='Only new Auto Gang Sheet public app resources' }).vpc
    $state.VpcId=$vpc.id; Save-State
  }
  $keyPath = Join-Path $SecretDirectory 'id_ed25519'
  if (!(Test-Path -LiteralPath $keyPath)) {
    & ssh-keygen.exe -t ed25519 -f $keyPath -N '' -C 'agsu-public-deploy-20261010' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'SSH key generation failed' }
  }
  Protect-Path $keyPath
  if (!$state.SshKeyId) {
    if (@((Invoke-DO GET 'account/keys?per_page=200').ssh_keys | Where-Object { $_.name -eq 'agsu-public-deploy' }).Count) { throw 'SSH key name already exists; do not overwrite it' }
    $key = (Invoke-DO POST 'account/keys' @{ name='agsu-public-deploy'; public_key=(Get-Content -LiteralPath ($keyPath + '.pub') -Raw).Trim() }).ssh_key
    $state.SshKeyId=$key.id; $state.SshKeyFingerprint=$key.fingerprint; Save-State
  }
  if (!$state.DropletId) {
    $cloudInit = @'
#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, caddy, postgresql-client, curl, ca-certificates]
ssh_pwauth: false
write_files:
  - path: /etc/ssh/sshd_config.d/agsu-public.conf
    permissions: '0600'
    content: |
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitRootLogin prohibit-password
  - path: /etc/caddy/Caddyfile
    permissions: '0644'
    content: |
      auto-gang-sheet.actualscope.com {
        encode zstd gzip
        reverse_proxy 127.0.0.1:3000
      }
runcmd:
  - [install, -d, -m, '0700', /opt/agsu-public]
  - [systemctl, enable, --now, docker]
  - [systemctl, reload, ssh]
  - [systemctl, enable, --now, caddy]
  - [systemctl, reload, caddy]
'@
    $droplet = (Invoke-DO POST 'droplets' @{ name='agsu-public-web'; region=$region; size='s-8vcpu-32gb-amd'; image='ubuntu-24-04-x64'; ssh_keys=@($state.SshKeyId); backups=$false; ipv6=$true; monitoring=$true; tags=@('agsu-public'); vpc_uuid=$state.VpcId; user_data=$cloudInit }).droplet
    if ($protectedDroplets -contains [long]$droplet.id) { throw 'Provider returned protected host identity' }
    $state.DropletId=$droplet.id; $state.DropletCreatedAt=$droplet.created_at; Save-State
  }
  $droplet = Assert-NewDroplet
  if (!$state.FirewallId) {
    if (@((Invoke-DO GET 'firewalls?per_page=200').firewalls | Where-Object { $_.name -eq 'agsu-public-firewall' }).Count) { throw 'Firewall name exists without owned state' }
    $trustedIp = (Invoke-RestMethod -Method Get -Uri 'https://api.ipify.org?format=json' -TimeoutSec 25).ip
    if ($trustedIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'SSH source is not an IPv4 address' }
    $firewall = (Invoke-DO POST 'firewalls' @{
      name='agsu-public-firewall'; droplet_ids=@([long]$droplet.id)
      inbound_rules=@(
        @{protocol='tcp';ports='22';sources=@{addresses=@($trustedIp+'/32')}}
        @{protocol='tcp';ports='80';sources=@{addresses=@('0.0.0.0/0','::/0')}}
        @{protocol='tcp';ports='443';sources=@{addresses=@('0.0.0.0/0','::/0')}}
      )
      outbound_rules=@(
        @{protocol='tcp';ports='all';destinations=@{addresses=@('0.0.0.0/0','::/0')}}
        @{protocol='udp';ports='all';destinations=@{addresses=@('0.0.0.0/0','::/0')}}
        @{protocol='icmp';destinations=@{addresses=@('0.0.0.0/0','::/0')}}
      )
    }).firewall
    $state.FirewallId=$firewall.id; $state.TrustedSshSource=$trustedIp+'/32'; Save-State
  }
  foreach ($spec in @(@{Key='PgId';Name='agsu-public-pg';Engine='pg';Version='16';Size='db-s-1vcpu-2gb';Storage=30720},@{Key='QueueId';Name='agsu-public-queue';Engine='valkey';Version='8';Size='db-s-1vcpu-1gb';Storage=10240})) {
    if (!$state[$spec.Key]) {
      $databaseRequest = @{ name=$spec.Name; engine=$spec.Engine; version=$spec.Version; region=$region; size=$spec.Size; num_nodes=1; private_network_uuid=$state.VpcId; tags=@('agsu-public'); rules=@(@{type='droplet';value=[string]$droplet.id}) }
      # Independently configurable disk storage is PostgreSQL-only; passing
      # storage_size_mib to a Valkey create returns HTTP422.
      if ($spec.Engine -eq 'pg') { $databaseRequest.storage_size_mib=$spec.Storage }
      $database = (Invoke-DO POST 'databases' $databaseRequest).database
      $state[$spec.Key]=$database.id; Save-State
    }
    $database = Assert-NewDatabase $state[$spec.Key] $spec.Name $spec.Engine
    # The provider refuses firewall updates while creating (HTTP422). Finish
    # locks trusted sources before saving/using any database credentials.
    if ($database.status -eq 'online') { Invoke-DO PUT ('databases/' + $database.id + '/firewall') @{rules=@(@{type='droplet';value=[string]$droplet.id})} | Out-Null }
  }
  Invoke-DO POST ('projects/' + $state.ProjectId + '/resources') @{ resources=@(('do:droplet:'+$state.DropletId),('do:dbaas:'+$state.PgId),('do:dbaas:'+$state.QueueId)) } | Out-Null
}
if ($Phase -eq 'Finish') {
  $droplet = Assert-NewDroplet
  $pg = Assert-NewDatabase $state.PgId 'agsu-public-pg' 'pg'
  $queue = Assert-NewDatabase $state.QueueId 'agsu-public-queue' 'valkey'
  if ($pg.status -ne 'online' -or $queue.status -ne 'online') { throw 'Databases are not online; rerun Status later' }
  foreach ($database in @($pg,$queue)) { Invoke-DO PUT ('databases/'+$database.id+'/firewall') @{rules=@(@{type='droplet';value=[string]$droplet.id})} | Out-Null }
  if (!@((Invoke-DO GET ('databases/'+$pg.id+'/dbs')).dbs | Where-Object {$_.name -eq 'public_app'}).Count) { Invoke-DO POST ('databases/'+$pg.id+'/dbs') @{name='public_app'} | Out-Null }
  # Provider-generated passwords are DPAPI encrypted for the current Windows
  # user. Never print connection URIs/passwords or put them in Git/log output.
  $state.PgPrivate=@{Host=$pg.private_connection.host;Port=$pg.private_connection.port;User=$pg.private_connection.user;Password=(ConvertTo-SecureString $pg.private_connection.password -AsPlainText -Force);Database='public_app';SSL=$pg.private_connection.ssl}
  $state.QueuePrivate=@{Host=$queue.private_connection.host;Port=$queue.private_connection.port;User=$queue.private_connection.user;Password=(ConvertTo-SecureString $queue.private_connection.password -AsPlainText -Force);Database=0;SSL=$queue.private_connection.ssl}
  Save-State
  Invoke-DO PATCH ('databases/'+$queue.id+'/config') @{config=@{valkey_maxmemory_policy='noeviction';valkey_persistence='rdb'}} | Out-Null
  $privateIp = @($droplet.networks.v4 | Where-Object {$_.type -eq 'private'})[0].ip_address
  $publicIp = @($droplet.networks.v4 | Where-Object {$_.type -eq 'public'})[0].ip_address
  if (!$publicIp -or !$privateIp) { throw 'New host IPs unavailable' }
  $state.PublicIp=$publicIp; $state.PrivateIp=$privateIp; Save-State
  $cfHeaders=@{Authorization=('Bearer '+$inventory.cloudflare.api_tokens.load_balancer_dns)}
  $zone='e76f45f120dfde1f63db1e53ee229582'; $hostName='auto-gang-sheet.actualscope.com'
  $records=Invoke-RestMethod -Method Get -Uri ('https://api.cloudflare.com/client/v4/zones/'+$zone+'/dns_records?name='+$hostName) -Headers $cfHeaders -TimeoutSec 25
  if (!$state.DnsRecordId) {
    if (@($records.result).Count) { throw 'Public hostname already has a record; never overwrite it' }
    $dns=Invoke-RestMethod -Method Post -Uri ('https://api.cloudflare.com/client/v4/zones/'+$zone+'/dns_records') -Headers $cfHeaders -ContentType 'application/json' -Body (@{type='A';name=$hostName;content=$publicIp;ttl=300;proxied=$false;comment='NEW isolated Auto Gang Sheet Upload public app'} | ConvertTo-Json -Compress) -TimeoutSec 25
    if (!$dns.success) { throw 'DNS creation not confirmed' }
    $state.DnsRecordId=$dns.result.id; Save-State
  } elseif (!@($records.result | Where-Object {$_.id -eq $state.DnsRecordId -and $_.content -eq $publicIp -and $_.type -eq 'A'}).Count) { throw 'Owned DNS record changed; do not overwrite it' }
}
if ($Phase -eq 'DatabaseRoles') {
  $droplet=Assert-NewDroplet
  if([long]$droplet.id -ne 607746803){throw 'Role provisioning is pinned to the new public host'}
  $pg=Assert-NewDatabase $state.PgId 'agsu-public-pg' 'pg'
  if($pg.status -ne 'online' -or !$state.PgPrivate){throw 'Finish must complete before role provisioning'}
  $rules=(Invoke-DO GET ('databases/'+$pg.id+'/firewall')).rules
  if(@($rules).Count -ne 1 -or $rules[0].type -ne 'droplet' -or [string]$rules[0].value -ne [string]$droplet.id){throw 'New PostgreSQL trusted sources must contain only the new host'}
  foreach($spec in @(@{User='agsu_migrate';Key='PgMigration'},@{User='agsu_app';Key='PgRuntime'})) {
    $users=@((Invoke-DO GET ('databases/'+$pg.id+'/users')).users | Where-Object {$_.name -eq $spec.User})
    $user=if($users.Count){$users[0]}else{(Invoke-DO POST ('databases/'+$pg.id+'/users') @{name=$spec.User}).user}
    if($user.name -ne $spec.User -or !$user.password){throw 'Provider user response incomplete; no password reset attempted'}
    $state[$spec.Key]=@{Host=$pg.private_connection.host;Port=$pg.private_connection.port;User=$user.name;Password=(ConvertTo-SecureString $user.password -AsPlainText -Force);Database='public_app';SSL=$true;CA='/run/secrets/pg-ca.pem'}
    Save-State
  }
  $certificate=(Invoke-DO GET ('databases/'+$pg.id+'/ca')).ca.certificate
  $caPath=Join-Path $SecretDirectory 'pg-ca.pem'
  [IO.File]::WriteAllBytes($caPath,[Convert]::FromBase64String($certificate)); Protect-Path $caPath
  $newIp=@($droplet.networks.v4 | Where-Object {$_.type -eq 'public'})[0].ip_address
  $scpOptions=@('-i',(Join-Path $SecretDirectory 'id_ed25519'),'-o','IdentitiesOnly=yes','-o',('UserKnownHostsFile='+(Join-Path $SecretDirectory 'known_hosts')),'-o','StrictHostKeyChecking=yes')
  & scp.exe @scpOptions $caPath "$($newIp -replace '^','root@'):/opt/agsu-public/pg-ca.pem"
  if($LASTEXITCODE -ne 0){throw 'CA transfer to new host failed'}
  foreach($file in @('bootstrap-postgres.sh','postgres-roles.sql','postgres-role-check.sql')) {
    & scp.exe @scpOptions (Join-Path $PSScriptRoot $file) "root@${newIp}:/opt/agsu-public/$file"
    if($LASTEXITCODE -ne 0){throw 'New host SQL helper transfer failed'}
  }
  Invoke-NewHostPsql 'setup' $state.PgPrivate
  Invoke-NewHostPsql 'check' $state.PgRuntime
  $state.PgRolesConfiguredAt=[DateTime]::UtcNow.ToString('o'); $state.PgCA=$caPath; Save-State
}
if ($state.DropletId) {
  $droplet=Assert-NewDroplet
  $pg=if($state.PgId){Assert-NewDatabase $state.PgId 'agsu-public-pg' 'pg'}
  $queue=if($state.QueueId){Assert-NewDatabase $state.QueueId 'agsu-public-queue' 'valkey'}
  [pscustomobject]@{ ProjectId=$state.ProjectId;VpcId=$state.VpcId;DropletId=$state.DropletId;DropletStatus=$droplet.status;FirewallId=$state.FirewallId;PgId=$state.PgId;PgStatus=$pg.status;QueueId=$state.QueueId;QueueStatus=$queue.status;PublicIp=@($droplet.networks.v4 | Where-Object {$_.type -eq 'public'})[0].ip_address;PrivateIp=@($droplet.networks.v4 | Where-Object {$_.type -eq 'private'})[0].ip_address;TrustedSshSource=$state.TrustedSshSource;DnsRecordId=$state.DnsRecordId;SecretState=$statePath;SSHKey=(Join-Path $SecretDirectory 'id_ed25519') } | ConvertTo-Json -Depth 3
} else { [pscustomobject]@{ ProjectId=$state.ProjectId;VpcId=$state.VpcId;Provisioning='Not yet created'} | ConvertTo-Json }
