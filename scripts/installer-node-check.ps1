[CmdletBinding()]
param([string]$NodePath,[Parameter(Mandatory=$true)][string]$ResultFile,[switch]$Discover)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'resolve-node.ps1')
$valid=$false;$message='';$version=''
try {
    if($Discover -and !$NodePath){$NodePath=Find-WdbNode}
    if(!$NodePath){throw 'No node.exe found in the installer PATH.'}
    $runtime=Resolve-WdbNode -RuntimeMode external-node -NodePath $NodePath
    $valid=$true;$version=$runtime.version
    $message='Validated Windows x64 Node '+$version+'.'
} catch {
    $message=$_.Exception.Message+' WDB runs as SYSTEM: Node and its parent directories must be protected from ordinary-user replacement. Install official Windows x64 Node >=22 system-wide (normally C:\Program Files\nodejs\node.exe), or ask an administrator to deploy it in a protected directory. Select that executable here, or use the with-node installer. Your terminal PATH will not be changed.'
}
# Unicode INI is readable by Inno without shell quoting or stdout parsing.
$NodePath=($NodePath -replace '[\r\n]',' ')
$message=($message -replace '[\r\n]',' ')
@('[Node]',('Path='+$NodePath),('Valid='+[int]$valid),('Message='+$message)) | Set-Content -LiteralPath $ResultFile -Encoding Unicode
if(!$valid){exit 1}
