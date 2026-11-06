[CmdletBinding()]
param([string]$DataDirectory="$env:ProgramData\wdb",[string]$NodePath,[string]$DesktopUser,[switch]$Development)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$installer=Join-Path $PSScriptRoot 'install-service.ps1'
if(!$Development -and !(Test-Path -LiteralPath (Join-Path $root 'PAYLOAD-SHA256SUMS.txt'))){throw 'Repair requires an installed release payload or rerunning its Setup.exe; missing files are not built on the target machine.'}
$record=Get-Content -LiteralPath (Join-Path $DataDirectory 'installation.json') -Raw | ConvertFrom-Json
if(!$DesktopUser){$DesktopUser=$record.desktopUser}
$mode='with-node'
$binding=Join-Path $root 'runtime-binding.json'
if(Test-Path -LiteralPath $binding){$saved=Get-Content -LiteralPath $binding -Raw | ConvertFrom-Json;$mode=$saved.runtimeMode;if(!$NodePath){$NodePath=$saved.path}}
foreach($value in @($DataDirectory,$NodePath,$DesktopUser,$installer)){if($value -match '["\r\n]'){throw 'Invalid installer parameter'}}
$arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -DataDirectory "{1}" -DesktopUser "{2}" -RuntimeMode {3}' -f $installer,$DataDirectory,$DesktopUser,$mode
if($NodePath){$arguments+=' -NodePath "'+$NodePath+'"'}
if($Development){$arguments+=' -Development'}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
 & $installer -DataDirectory $DataDirectory -DesktopUser $DesktopUser -RuntimeMode $mode -NodePath $NodePath -Development:$Development
 if($LASTEXITCODE){throw "Repair failed: $LASTEXITCODE"}
}else{
 $process=Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -PassThru -Wait
 if($process.ExitCode -ne 0){throw "Repair failed: $($process.ExitCode). Use the matching Setup.exe for missing or changed payload files."}
}
& (Join-Path $PSScriptRoot 'service.ps1') diagnose -DataDirectory $DataDirectory
