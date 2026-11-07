param([string]$Module)
$ErrorActionPreference='Stop'
. $Module
$location='Software\WdbPathTests\'+[guid]::NewGuid().ToString('N')
$root=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($location)
$environmentKey=$root.CreateSubKey('Environment');$ownerKey=$root.CreateSubKey('Owner')
function Assert($Condition,[string]$Message){if(!$Condition){throw $Message}}
try {
 $entry='C:\Program Files\wdb\bin';$original='%SystemRoot%\System32;C:\Unrelated Tool'
 $environmentKey.SetValue('Path',$original,[Microsoft.Win32.RegistryValueKind]::ExpandString)
 Set-WdbPathRegistration $environmentKey $ownerKey $entry
 Set-WdbPathRegistration $environmentKey $ownerKey $entry
 Assert ((Get-WdbRawPath $environmentKey) -ceq ($original+';'+$entry)) 'Install/upgrade must add exactly once'
 Assert ($environmentKey.GetValueKind('Path') -eq 'ExpandString') 'Registry type changed'
 $environmentKey.SetValue('Path',((Get-WdbRawPath $environmentKey)+';C:\Added Later'),[Microsoft.Win32.RegistryValueKind]::ExpandString)
 Set-WdbPathRegistration $environmentKey $ownerKey $entry -Remove
 Assert ((Get-WdbRawPath $environmentKey) -ceq ($original+';C:\Added Later')) 'Uninstall removed another entry or expanded variables'
 $existing=$original+';"C:\PROGRAM FILES\wdb\bin\"'
 $environmentKey.SetValue('Path',$existing,[Microsoft.Win32.RegistryValueKind]::String)
 Set-WdbPathRegistration $environmentKey $ownerKey $entry
 Set-WdbPathRegistration $environmentKey $ownerKey $entry -Remove
 Assert ((Get-WdbRawPath $environmentKey) -ceq $existing) 'Pre-existing PATH entry must not be claimed or removed'
 Assert ($environmentKey.GetValueKind('Path') -eq 'String') 'String registry type changed'
 Write-Output 'PATH install, duplicate upgrade, rollback/uninstall, concurrent unrelated edits and pre-existing ownership passed'
}finally{$environmentKey.Dispose();$ownerKey.Dispose();$root.Dispose();[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($location)}
