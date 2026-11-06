[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ClientCli,[Parameter(Mandatory=$true)][string]$ClientConfig,[Parameter(Mandatory=$true)][string]$Device,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\')
$ClientCli=[IO.Path]::GetFullPath($ClientCli);$ClientConfig=[IO.Path]::GetFullPath($ClientConfig)
if(!$OutputDirectory){$OutputDirectory=Join-Path $root 'artifacts\installed-isolation'}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run as the normal non-elevated desktop user to test the installed ACL.'}
$install="$env:ProgramFiles\wdb"
$node=Join-Path $install 'runtime\node.exe'
$report=[ordered]@{status='running';startedAt=[DateTime]::UtcNow.ToString('o');sourceDirectories=@();normalUserCannotWrite=$false;errors=@()}
$away=Join-Path $root ('.runtime\source-isolation-'+[guid]::NewGuid().ToString('N'))
$moved=@()
try {
 $probe=Join-Path $install ('acl-validation-'+[guid]::NewGuid().ToString('N')+'.tmp')
 try{$stream=[IO.File]::Open($probe,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write);$stream.Dispose();Remove-Item -LiteralPath $probe;throw 'Normal user can write to the installed program directory'}catch [UnauthorizedAccessException]{$report.normalUserCannotWrite=$true}
 New-Item -ItemType Directory -Path $away | Out-Null
 foreach($name in @('src','native')) {
  $source=[IO.Path]::GetFullPath((Join-Path $root $name));$destination=[IO.Path]::GetFullPath((Join-Path $away $name))
  if((Split-Path $source -Parent) -ine $root -or !$destination.StartsWith($root+'\.runtime\source-isolation-',[StringComparison]::OrdinalIgnoreCase)){throw 'Source isolation target escaped the workspace'}
  if((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Do not isolate a redirected source tree'}
  Move-Item -LiteralPath $source -Destination $destination
  $moved+=@{source=$source;destination=$destination};$report.sourceDirectories+=$name
 }
 Restart-Service WdbService
 $info=$null
 for($attempt=0;$attempt -lt 20;$attempt++){
  $output=& $node $ClientCli info --config $ClientConfig --device $Device --json
  if($LASTEXITCODE -eq 0){$info=$output | ConvertFrom-Json;break};Start-Sleep -Milliseconds 500
 }
 if(!$info -or !$info.data.desktop.available){throw 'Installed service/desktop did not become healthy without source directories'}
 $shell=& $node $ClientCli shell --script "[Console]::Write('installed-source-independent')" --config $ClientConfig --device $Device --json | ConvertFrom-Json
 if($LASTEXITCODE -ne 0 -or $shell.data.data.stdout -ne 'installed-source-independent' -or $shell.data.data.isElevated){throw 'Installed normal-user helper shell failed'}
 $report.deviceId=$info.deviceId;$report.service='Running';$report.desktopAvailable=$true;$report.helperUser=$shell.data.data.identity;$report.runtime=$node;$report.cli=$ClientCli;$report.status='pass'
}catch{$report.status='fail';$report.errors+=$_.Exception.Message}
finally{
 foreach($item in $moved){if(Test-Path -LiteralPath $item.source){throw 'Refusing to overwrite a recreated source directory during restore'};Move-Item -LiteralPath $item.destination -Destination $item.source}
 if((Test-Path -LiteralPath $away) -and !(Get-ChildItem -LiteralPath $away -Force | Select-Object -First 1)){Remove-Item -LiteralPath $away}
 $report.sourceRestored=@($moved | Where-Object {!(Test-Path -LiteralPath $_.source)}).Count -eq 0
 $report.endedAt=[DateTime]::UtcNow.ToString('o');$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'report.json') -Encoding UTF8
}
if($report.status -ne 'pass'){throw ($report.errors -join '; ')}
$report | ConvertTo-Json -Depth 6
