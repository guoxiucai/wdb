# Windows PowerShell 5.1. Preserve unexpanded PATH text, registry type and unrelated entries.
function Get-WdbPathParts([string]$Value,[string]$Entry) {
 $wanted=[Environment]::ExpandEnvironmentVariables($Entry.Trim().Trim('"')).TrimEnd('\','/')
 $parts=@($Value.Split(';'))
 $matches=@(for($i=0;$i -lt $parts.Count;$i++){
  $candidate=[Environment]::ExpandEnvironmentVariables($parts[$i].Trim().Trim('"')).TrimEnd('\','/')
  if($candidate -ieq $wanted){$i}
 })
 return @{parts=$parts;matches=$matches}
}
function Get-WdbRawPath($Key) {return [string]$Key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}
function Test-WdbMachinePath([string]$Entry) {
 $key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment')
 try{return (Get-WdbPathParts (Get-WdbRawPath $key) $Entry).matches.Count -gt 0}finally{$key.Dispose()}
}
function Set-WdbPathRegistration($EnvironmentKey,$OwnerKey,[string]$Entry,[switch]$Remove) {
 $value=Get-WdbRawPath $EnvironmentKey;$plan=Get-WdbPathParts $value $Entry
 $kind=if($EnvironmentKey.GetValueNames() -contains 'Path'){$EnvironmentKey.GetValueKind('Path')}else{[Microsoft.Win32.RegistryValueKind]::ExpandString}
 if($Remove){
  if([string]$OwnerKey.GetValue('MachinePathEntry','') -ine $Entry){return}
  $remaining=@(for($i=0;$i -lt $plan.parts.Count;$i++){if($i -notin $plan.matches){$plan.parts[$i]}})
  if($plan.matches.Count){$EnvironmentKey.SetValue('Path',($remaining -join ';'),$kind)}
  $OwnerKey.DeleteValue('MachinePathEntry',$false)
 }elseif(!$plan.matches.Count){
  $OwnerKey.SetValue('MachinePathEntry',$Entry,[Microsoft.Win32.RegistryValueKind]::String)
  $separator=if(!$value -or $value.EndsWith(';')){''}else{';'}
  $EnvironmentKey.SetValue('Path',($value+$separator+$Entry),$kind)
 }
}
function Update-WdbMachinePath([string]$Entry,[switch]$Remove) {
 $environmentKey=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment',$true)
 $ownerKey=[Microsoft.Win32.Registry]::LocalMachine.CreateSubKey('SOFTWARE\WDB')
 try{Set-WdbPathRegistration $environmentKey $ownerKey $Entry -Remove:$Remove}finally{$environmentKey.Dispose();$ownerKey.Dispose()}
}
