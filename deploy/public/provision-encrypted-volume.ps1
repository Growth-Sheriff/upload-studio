[CmdletBinding()]
param([ValidateSet('Prepare','Status')][string]$Phase='Status')
$ErrorActionPreference='Stop'
$agsuSecretDirectory='C:\Users\mhmmd\.codex\secrets\agsu-public'
$agsuStatePath=Join-Path $agsuSecretDirectory 'digitalocean.clixml'
$agsuState=Import-Clixml -LiteralPath $agsuStatePath
$agsuInventory=Get-Content -LiteralPath 'C:\Users\mhmmd\Desktop\credentials-envanteri.json' -Raw | ConvertFrom-Json
$agsuHeaders=@{Authorization=('Bearer '+$agsuInventory.gsb_ops.digitalocean_doctl.access_token)}
function Invoke-AgsuDO([string]$Method,[string]$Path,$Body=$null) {
  $agsuRequest=@{Method=$Method;Uri=('https://api.digitalocean.com/v2/'+$Path);Headers=$agsuHeaders;TimeoutSec=40}
  if($null -ne $Body) {$agsuRequest.ContentType='application/json';$agsuRequest.Body=$Body|ConvertTo-Json -Depth 8 -Compress}
  try {Invoke-RestMethod @agsuRequest} catch {throw "DigitalOcean $Method $Path failed; inspect metadata before retry, no raw response logged."}
}
$agsuAccount=(Invoke-AgsuDO GET account).account
if($agsuAccount.email -ne 'mhmmdadgzl@outlook.com' -or $agsuAccount.status -ne 'active') {throw 'Wrong provider account'}
$agsuDroplet=(Invoke-AgsuDO GET droplets/607746803).droplet
if($agsuState.DropletId -ne 607746803 -or $agsuDroplet.name -ne 'agsu-public-web' -or $agsuDroplet.vpc_uuid -ne $agsuState.VpcId -or $agsuDroplet.created_at -ne $agsuState.DropletCreatedAt -or $agsuDroplet.region.slug -ne 'nyc3') {throw 'Not the new isolated public host'}
if($Phase -eq 'Prepare') {
  if(!$agsuState.VolumeId) {
    $existing=@((Invoke-AgsuDO GET 'volumes?region=nyc3&per_page=200').volumes|Where-Object {$_.name -eq 'agsu-public-secure'})
    if($existing.Count) {throw 'Volume name exists without owned state; do not duplicate/adopt'}
    $agsuVolume=(Invoke-AgsuDO POST volumes @{name='agsu-public-secure';region='nyc3';size_gigabytes=40;filesystem_type='ext4';description='Only new public-app Docker, secrets and Caddy data; provider encrypted';tags=@('agsu-public')}).volume
    $agsuState.VolumeId=$agsuVolume.id
    $agsuState.VolumeCreatedAt=$agsuVolume.created_at
    $agsuState|Export-Clixml -LiteralPath $agsuStatePath
    $agsuIdentity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $agsuStatePath /inheritance:r /grant:r "${agsuIdentity}:F" '*S-1-5-18:F'|Out-Null
    if($LASTEXITCODE -ne 0) {throw 'Credentials ACL restriction failed'}
  }
}
if(!$agsuState.VolumeId) {throw 'No owned volume yet'}
$agsuVolume=(Invoke-AgsuDO GET ('volumes/'+$agsuState.VolumeId)).volume
if($agsuVolume.name -ne 'agsu-public-secure' -or $agsuVolume.region.slug -ne 'nyc3' -or $agsuVolume.size_gigabytes -ne 40 -or $agsuVolume.created_at -ne $agsuState.VolumeCreatedAt) {throw 'Unexpected volume identity'}
if(@($agsuVolume.droplet_ids|Where-Object {$_ -ne 607746803}).Count) {throw 'Volume is attached to another host'}
if($Phase -eq 'Prepare') {
  if(@($agsuVolume.droplet_ids).Count -eq 0) {
    $agsuAction=(Invoke-AgsuDO POST ('volumes/'+$agsuVolume.id+'/actions') @{type='attach';droplet_id=607746803;region='nyc3'}).action
    Write-Output ('NEW_VOLUME_ATTACH_ACTION='+$agsuAction.id)
  }
  Invoke-AgsuDO POST ('projects/'+$agsuState.ProjectId+'/resources') @{resources=@('do:volume:'+$agsuVolume.id)}|Out-Null
}
Write-Output ('VOLUME_ID='+$agsuVolume.id)
Write-Output ('VOLUME_NAME='+$agsuVolume.name+' REGION=nyc3 SIZE_GIB=40 MONTHLY_USD=4')
Write-Output ('ATTACHED_DROPLETS='+(@($agsuVolume.droplet_ids)-join ','))
Write-Output 'No service was stopped or restarted. Mount/cutover is a separate coordinated operation.'
