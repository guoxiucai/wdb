[CmdletBinding()]
param([string]$InstallDirectory="$env:ProgramFiles\wdb",[string]$DataDirectory="$env:ProgramData\wdb",[string]$DesktopUser,[int]$Port=18766,[int]$HelperPort=18767,[string]$ListenAddress,[ValidateSet('with-node','external-node')][string]$RuntimeMode,[string]$NodePath,[switch]$Development)
$ErrorActionPreference='Stop'
if($Development){
 $legacy=Join-Path $PSScriptRoot 'install-development-service.ps1'
 if(!(Test-Path -LiteralPath $legacy)){throw 'Development installation requires a source checkout; it is not included in production payloads.'}
 & $legacy -InstallDirectory $InstallDirectory -DataDirectory $DataDirectory -DesktopUser $DesktopUser -Port $Port -HelperPort $HelperPort -ListenAddress $ListenAddress -Development
 exit
}
$root=Split-Path $PSScriptRoot -Parent
if(!(Test-Path -LiteralPath (Join-Path $root 'PAYLOAD-SHA256SUMS.txt'))){throw 'A prepared release payload is required. Run build-release.ps1 on the build machine, or use -Development explicitly. Customers never compile missing components.'}
& (Join-Path $PSScriptRoot 'installer-action.ps1') -Action Install -SourceDirectory $root -InstallDirectory $InstallDirectory -DataDirectory $DataDirectory -DesktopUser $DesktopUser -Port $Port -HelperPort $HelperPort -ListenAddress $ListenAddress -RuntimeMode $RuntimeMode -NodePath $NodePath
exit $LASTEXITCODE
