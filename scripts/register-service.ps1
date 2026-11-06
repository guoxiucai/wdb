param([Parameter(Mandatory=$true)][string]$InstallDirectory,[Parameter(Mandatory=$true)][string]$DataDirectory,[Parameter(Mandatory=$true)][string]$DesktopUser,[int]$Port=18766,[int]$HelperPort=18767,[string]$ListenAddress='127.0.0.1',[Parameter(Mandatory=$true)]$Runtime)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'service-config.ps1')
$desktopSid=(New-Object Security.Principal.NTAccount($DesktopUser)).Translate([Security.Principal.SecurityIdentifier]).Value
New-Item -ItemType Directory -Path $DataDirectory,(Join-Path $DataDirectory 'logs') -Force | Out-Null
& icacls.exe $DataDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${desktopSid}:(OI)(CI)M" | Out-Null
if($LASTEXITCODE -ne 0){throw 'Data ACL update failed'}
& (Join-Path $PSScriptRoot 'init-data.ps1') -DataDir $DataDirectory | Out-Null
$hostExe=Join-Path $InstallDirectory 'native\WdbServiceHost.exe'
$serviceArgs='"{0}" --node "{1}" --script "{2}" --data-dir "{3}" --port {4} --host {5}' -f $hostExe,$Runtime.path,(Join-Path $InstallDirectory 'src\server.js'),$DataDirectory,$Port,$ListenAddress
if(Get-Service WdbService -ErrorAction SilentlyContinue){Set-WdbServiceConfiguration -Name WdbService -BinaryPath $serviceArgs}
else{New-Service -Name WdbService -DisplayName 'Windows Debug Bridge' -Description 'WDB HTTPS service and isolated desktop helper' -BinaryPathName $serviceArgs -StartupType Automatic | Out-Null}
& sc.exe failure WdbService reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
if($LASTEXITCODE -ne 0){throw 'SCM recovery configuration failed'}
$sddl=(& sc.exe sdshow WdbService | Where-Object {$_ -match '^D:'} | Select-Object -First 1).Trim()
if($sddl -notmatch [regex]::Escape($desktopSid)){
 $ace="(A;;CCLCSWRPWPDTLOCRRC;;;$desktopSid)";$index=$sddl.IndexOf('S:');if($index -ge 0){$sddl=$sddl.Insert($index,$ace)}else{$sddl+=$ace}
 & sc.exe sdset WdbService $sddl | Out-Null;if($LASTEXITCODE -ne 0){throw 'Service lifecycle ACL update failed'}
}
$helperArgs='--helper --node "{0}" --script "{1}" --data-dir "{2}" --port {3}' -f $Runtime.path,(Join-Path $InstallDirectory 'src\helper.js'),$DataDirectory,$HelperPort
$action=New-ScheduledTaskAction -Execute $hostExe -Argument $helperArgs -WorkingDirectory $InstallDirectory
$principal=New-ScheduledTaskPrincipal -UserId $DesktopUser -LogonType Interactive -RunLevel Limited
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $DesktopUser
$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden
Register-ScheduledTask -TaskName WdbDesktopHelper -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'WDB interactive desktop helper; limited user' -Force | Out-Null
$Runtime | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallDirectory 'runtime-binding.json') -Encoding UTF8
[ordered]@{installedAt=[DateTime]::UtcNow.ToString('o');installDirectory=$InstallDirectory;dataDirectory=$DataDirectory;serverRoot=$InstallDirectory;desktopUser=$DesktopUser;port=$Port;helperPort=$HelperPort;development=$false;listenAddress=$ListenAddress;runtimeMode=$Runtime.runtimeMode;nodePath=$Runtime.path} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataDirectory 'installation.json') -Encoding UTF8
# Preserve the selected LAN scope while rebinding its executable after a switch.
$networkFile=Join-Path $DataDirectory 'network.json'
if(Test-Path -LiteralPath $networkFile){
 $network=Get-Content -LiteralPath $networkFile -Raw | ConvertFrom-Json
 Get-NetFirewallRule -Name 'WdbService-LAN' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
 if($network.mode -eq 'Lan'){
  New-NetFirewallRule -Name 'WdbService-LAN' -DisplayName 'WDB HTTPS from selected LAN' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalPort $Port -LocalAddress $network.localAddress -RemoteAddress $network.remoteAddress -InterfaceAlias $network.interfaceAlias -Program $Runtime.path -EdgeTraversalPolicy Block | Out-Null
 }
}
Start-Service WdbService
Start-ScheduledTask -TaskName WdbDesktopHelper
$diagnostic=$null
for($attempt=0;$attempt -lt 15;$attempt++){
 try{$raw=& $Runtime.path (Join-Path $InstallDirectory 'scripts\installer-health.js') $DataDirectory $Port $HelperPort 2>$null;if($LASTEXITCODE -eq 0){$diagnostic=$raw | ConvertFrom-Json;if($diagnostic.desktop.available -or $attempt -ge 5){break}}}catch{}
 Start-Sleep -Milliseconds 600
}
if(!$diagnostic){throw 'Service failed HTTPS startup validation'}
$service=Get-CimInstance Win32_Service -Filter "Name='WdbService'"
$child=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ParentProcessId -eq $service.ProcessId -and $_.ExecutablePath -eq $Runtime.path})
if($service.State -ne 'Running' -or $service.StartName -ne 'LocalSystem' -or $child.Count -ne 1){throw 'SYSTEM service runtime binding is not active'}
$diagnostic | Add-Member NoteProperty serviceProcessId $service.ProcessId
$diagnostic | Add-Member NoteProperty serverProcessId $child[0].ProcessId
$diagnostic | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $InstallDirectory 'installation-health.json') -Encoding UTF8
$diagnostic | ConvertTo-Json -Depth 8
