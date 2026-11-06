[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BuildDirectory,[Parameter(Mandatory=$true)][string]$ClientCli,[Parameter(Mandatory=$true)][string]$ClientConfig,[Parameter(Mandatory=$true)][string]$DesktopUser,[string]$Device='172.20.115.75',[string]$OutputDirectory,[string]$ExternalNode="$env:ProgramFiles\WdbTestRuntime\node.exe")
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$root=Split-Path $PSScriptRoot -Parent
$BuildDirectory=[IO.Path]::GetFullPath($BuildDirectory);$ClientCli=[IO.Path]::GetFullPath($ClientCli);$ClientConfig=[IO.Path]::GetFullPath($ClientConfig)
if(!$OutputDirectory){$OutputDirectory=Join-Path $root ('artifacts\release-live-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory);New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$release=Join-Path $BuildDirectory 'release\Development'
$with=@(Get-ChildItem -LiteralPath $release -Filter '*-with-node-*-setup.exe');$external=@(Get-ChildItem -LiteralPath $release -Filter '*-external-node-*-setup.exe')
if($with.Count -ne 1 -or $external.Count -ne 1){throw 'Exactly two development installer variants are required'}
$report=[ordered]@{startedAt=[DateTime]::UtcNow.ToString('o');status='running';buildId=(Split-Path $BuildDirectory -Leaf);checks=@();environment=@{os=(Get-CimInstance Win32_OperatingSystem).Version;desktopUser=$DesktopUser};errors=@()}
$reportFile=Join-Path $OutputDirectory 'report.json'
function Save-Report {$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportFile -Encoding UTF8}
function Add-Check([string]$Name,$Evidence){$report.checks+=@{name=$Name;status='pass';evidence=$Evidence};Save-Report;Write-Output "$Name`: pass"}
function Install-Exe([string]$Mode,[string]$Label,[string]$NodePath='',[switch]$ExpectFailure){
 $exe=$(if($Mode -eq 'with-node'){$with[0].FullName}else{$external[0].FullName});$log=Join-Path $OutputDirectory ($Label+'.log')
 $arguments='/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DESKTOPUSER="{0}" /LOG="{1}"' -f $DesktopUser,$log
 if($NodePath){$arguments+=' /NODEPATH="'+$NodePath+'"'}
 $process=Start-Process -FilePath $exe -WindowStyle Hidden -ArgumentList $arguments -PassThru
 while(!$process.WaitForExit(2000)){Save-Report;Get-Content -LiteralPath "$env:ProgramData\WdbInstaller\installer.log" -Tail 20 -ErrorAction SilentlyContinue | Set-Content -LiteralPath (Join-Path $OutputDirectory 'installer-progress.log') -Encoding UTF8}
 if($ExpectFailure){if($process.ExitCode -eq 0){throw "Expected dependency rejection: $Label"}}
 elseif($process.ExitCode -ne 0){throw "$Label installer exit $($process.ExitCode); see $log"}
 return $process.ExitCode
}
function Identity-Snapshot {
 $data="$env:ProgramData\wdb"
 $config=Get-Content -LiteralPath (Join-Path $data 'config.json') -Raw | ConvertFrom-Json
 $clients=Get-Content -LiteralPath (Join-Path $data 'clients.json') -Raw | ConvertFrom-Json
 @{deviceId=$config.deviceId;tls=(Get-FileHash -LiteralPath (Join-Path $data 'tls.pfx')).Hash;clients=$clients}
}
function Assert-Preserved($Before) {
 $after=Identity-Snapshot
 if($Before.deviceId -ne $after.deviceId -or $Before.tls -ne $after.tls){throw 'Device ID or TLS identity changed'}
 foreach($client in $Before.clients){$current=$after.clients | Where-Object id -eq $client.id;if(!$current -or $current.tokenHash -ne $client.tokenHash -or $current.remembered -ne $client.remembered -or $current.revokedAt -ne $client.revokedAt){throw 'Stored authorization changed during installation'}}
}
function Verify-Mode([string]$Mode,[string]$Label,[switch]$Operations){
 $binding=Get-Content -LiteralPath "$env:ProgramFiles\wdb\runtime-binding.json" -Raw | ConvertFrom-Json
 if($binding.runtimeMode -ne $Mode){throw 'Runtime mode mismatch'}
 $expected=$(if($Mode -eq 'with-node'){"$env:ProgramFiles\wdb\runtime\node.exe"}else{$ExternalNode})
 if($binding.path -ine $expected){throw 'Wrong bound Node'}
 if($Mode -eq 'external-node' -and (Test-Path -LiteralPath "$env:ProgramFiles\wdb\runtime\node.exe")){throw 'External mode retained private Node'}
 $service=Get-CimInstance Win32_Service -Filter "Name='WdbService'"
 if($service.State -ne 'Running' -or $service.StartName -ne 'LocalSystem' -or $service.PathName -notlike "*--node `"$expected`"*"){throw 'SCM runtime binding/identity incorrect'}
 $task=Get-ScheduledTask -TaskName WdbDesktopHelper
 if($task.Actions.Arguments -notlike "*--node `"$expected`"*" -or $task.Principal.RunLevel -ne 'Limited'){throw 'Interactive helper runtime/permissions incorrect'}
 $helperNodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ExecutablePath -ieq $expected -and $_.CommandLine -like '*wdb\src\helper.js*' -and $_.SessionId -gt 0})
 if($helperNodes.Count -ne 1){throw 'Expected one interactive helper on the bound runtime'}
 $rule=Get-NetFirewallRule -Name WdbService-LAN -ErrorAction SilentlyContinue
 if($rule -and ($rule | Get-NetFirewallApplicationFilter).Program -ine $expected){throw 'Firewall runtime binding differs'}
 Assert-Preserved $before
 if($Operations){
  & $ExternalNode (Join-Path $root 'scripts\validate-lan.js') --cli $ClientCli --config $ClientConfig --device $Device --output (Join-Path $OutputDirectory ($Label+'-lan')) *> (Join-Path $OutputDirectory ($Label+'-lan.log'))
  if($LASTEXITCODE -ne 0){throw "$Label LAN smoke failed"}
  & $ExternalNode (Join-Path $root 'scripts\validate-recording.js') --cli $ClientCli --config $ClientConfig --device $Device --output (Join-Path $OutputDirectory ($Label+'-recording')) *> (Join-Path $OutputDirectory ($Label+'-recording.log'))
  if($LASTEXITCODE -ne 0){throw "$Label recording failed"}
 }
 Add-Check $Label @{mode=$Mode;node=$expected;serviceIdentity='LocalSystem';helperSession=$helperNodes[0].SessionId;deviceId=$before.deviceId;credentialsPreserved=$true;firewallMatches=$true;installedBytes=(Get-ChildItem -LiteralPath "$env:ProgramFiles\wdb" -Recurse -File | Measure-Object Length -Sum).Sum;operations=[bool]$Operations}
}
$before=Identity-Snapshot
Save-Report
try {
 . (Join-Path $PSScriptRoot 'resolve-node.ps1')
 $null=Resolve-WdbNode -RuntimeMode external-node -NodePath $ExternalNode
 $externalHash=(Get-FileHash -LiteralPath $ExternalNode).Hash
 $null=Install-Exe with-node 'with-node-upgrade'
 Verify-Mode with-node 'with-node-upgrade' -Operations
 # Exercise the same transaction used by Setup with a deterministic copy-time
 # corruption. This is validation-only; production installers have no fault flag.
 $sourcePayload=Join-Path $BuildDirectory 'payloads\external-node'
 $actionScript=Join-Path $sourcePayload 'scripts\installer-action.ps1'
 $transactionArgs='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -SourceDirectory "{1}" -DesktopUser "{2}" -NodePath "{3}"' -f $actionScript,$sourcePayload,$DesktopUser,$ExternalNode
 $begin=Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ($transactionArgs+' -Action Begin') -PassThru -Wait
 if($begin.ExitCode -ne 0){throw 'Rollback fixture could not begin'}
 try{
  foreach($file in Get-ChildItem -LiteralPath $sourcePayload -Recurse -File){$relative=$file.FullName.Substring($sourcePayload.Length+1);$destination=Join-Path "$env:ProgramFiles\wdb" $relative;New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null;Copy-Item -LiteralPath $file.FullName -Destination $destination -Force}
  [IO.File]::AppendAllText("$env:ProgramFiles\wdb\src\server.js","`n// deliberate validation-only copy corruption`n")
  $commit=Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ($transactionArgs+' -Action Commit') -RedirectStandardError (Join-Path $OutputDirectory 'rollback-expected-error.log') -PassThru -Wait
  if($commit.ExitCode -eq 0){throw 'Corrupted installed content was accepted'}
 }finally{
  $rollback=Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ($transactionArgs+' -Action Rollback') -PassThru -Wait
  if($rollback.ExitCode -ne 0){throw 'Rollback failed'}
 }
 Verify-Mode with-node 'failed-upgrade-restored-old-runtime'
 Add-Check 'copy-corruption-rejected-and-rolled-back' @{commitExit=$commit.ExitCode;rollbackExit=$rollback.ExitCode;userDataPreserved=$true}
 $pidBefore=(Get-CimInstance Win32_Service -Filter "Name='WdbService'").ProcessId
 $missing=Install-Exe external-node 'missing-node' 'C:\Program Files\WdbMissingRuntime\node.exe' -ExpectFailure
 if((Get-CimInstance Win32_Service -Filter "Name='WdbService'").ProcessId -ne $pidBefore){throw 'Missing Node disturbed existing service'}
 Add-Check 'missing-node-rejected-before-stop' @{exitCode=$missing;servicePidUnchanged=$true}
 $unsafe=Install-Exe external-node 'unsafe-node' 'D:\soft\node\nvm\v24.15.0\node.exe' -ExpectFailure
 if((Get-CimInstance Win32_Service -Filter "Name='WdbService'").ProcessId -ne $pidBefore){throw 'Unsafe Node disturbed existing service'}
 Add-Check 'user-node-rejected-before-stop' @{exitCode=$unsafe;servicePidUnchanged=$true}
 $null=Install-Exe external-node 'switch-to-external' $ExternalNode
 Verify-Mode external-node 'switch-to-external' -Operations
 $null=Install-Exe external-node 'external-upgrade' $ExternalNode
 Verify-Mode external-node 'external-upgrade'
 & $ExternalNode (Join-Path $root 'scripts\validate-sse-windows.js') --cli $ClientCli --config $ClientConfig --device $Device --output (Join-Path $OutputDirectory 'external-sse') --restart true *> (Join-Path $OutputDirectory 'external-sse.log')
 if($LASTEXITCODE -ne 0){throw 'Installed npm CLI SSE validation failed'}
 Add-Check 'installed-npm-cli-sse' @{report='external-sse/report.json';checks=8}
 # Move only the named test runtime after stopping both users of its image.
 Stop-Service WdbService
 $hosts=@(Get-CimInstance Win32_Process -Filter "Name='WdbServiceHost.exe'" | Where-Object {$_.ExecutablePath -ieq "$env:ProgramFiles\wdb\native\WdbServiceHost.exe" -and $_.CommandLine -like '*--helper*'})
 foreach($hostProcess in $hosts){& taskkill.exe /PID $hostProcess.ProcessId /T /F | Out-Null};Stop-ScheduledTask WdbDesktopHelper
 if([IO.Path]::GetFullPath($ExternalNode) -ine "$env:ProgramFiles\WdbTestRuntime\node.exe"){throw 'Runtime removal test is restricted to WdbTestRuntime\node.exe'}
 $missingPath=$ExternalNode+'.missing';if(Test-Path -LiteralPath $missingPath){throw 'Runtime test backup already exists'}
 try{
  Move-Item -LiteralPath $ExternalNode -Destination $missingPath
  Start-Service WdbService;Start-Sleep -Milliseconds 800
  $diagOutput=Join-Path $OutputDirectory 'missing-runtime-diagnose.json'
  $diagError=Join-Path $OutputDirectory 'missing-runtime-diagnose.stderr'
  $diagProcess=Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$env:ProgramFiles+'\wdb\scripts\service.ps1" diagnose') -RedirectStandardOutput $diagOutput -RedirectStandardError $diagError -PassThru
  if(!$diagProcess.WaitForExit(20000)){Stop-Process -Id $diagProcess.Id -Force;throw 'Runtime diagnostic exceeded 20 seconds; restoring the test runtime'}
  if($diagProcess.ExitCode -ne 0){throw 'Runtime diagnostic failed'}
  $diag=Get-Content -LiteralPath $diagOutput -Raw | ConvertFrom-Json
  if($diag.runtime.status -ne 'invalid'){throw 'Missing bound runtime was not diagnosed'}
  Add-Check 'removed-external-runtime-diagnosed' @{scmMayRemainRunning=$true;runtimeStatus='invalid';pathFallback=$false}
 }finally{Stop-Service WdbService -ErrorAction SilentlyContinue;if(Test-Path -LiteralPath $missingPath){Move-Item -LiteralPath $missingPath -Destination $ExternalNode};Start-Service WdbService;Start-ScheduledTask WdbDesktopHelper}
 $null=Install-Exe with-node 'switch-back-with-node'
 Verify-Mode with-node 'switch-back-with-node'
 $uninstaller=Get-ChildItem -LiteralPath "$env:ProgramFiles\wdb" -Filter 'unins*.exe' | Select-Object -First 1
 $uninstall=Start-Process -FilePath $uninstaller.FullName -WindowStyle Hidden -ArgumentList ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="'+(Join-Path $OutputDirectory 'uninstall.log')+'"') -PassThru -Wait
 if($uninstall.ExitCode -ne 0){throw 'Uninstaller failed'}
 if((Get-Service WdbService -ErrorAction SilentlyContinue) -or (Get-ScheduledTask WdbDesktopHelper -ErrorAction SilentlyContinue) -or (Get-NetFirewallRule -Name WdbService-LAN -ErrorAction SilentlyContinue)){throw 'Uninstall left WDB service/task/firewall'}
 $remaining=@(Get-ChildItem -LiteralPath "$env:ProgramFiles\wdb" -Recurse -File -ErrorAction SilentlyContinue)
 if($remaining.Count){throw 'Uninstall left installed program files'}
 Assert-Preserved $before
 if((Get-FileHash -LiteralPath $ExternalNode).Hash -ne $externalHash){throw 'External Node was modified by WDB uninstallation'}
 Add-Check 'uninstall-preserves-data-and-external-node' @{serviceRemoved=$true;helperRemoved=$true;firewallRemoved=$true;programFilesRemaining=0;dataPreserved=$true;externalNodePreserved=$true}
 $null=Install-Exe with-node 'reinstall-with-node'
 Verify-Mode with-node 'reinstall-with-node' -Operations
 $report.status='passed'
}catch{$report.status='failed';$report.errors+= $_.Exception.Message;Write-Output $_.Exception.Message}
finally{
 # Always leave a working with-node service, including after a failed scenario.
 try{
  $binding=Get-Content -LiteralPath "$env:ProgramFiles\wdb\runtime-binding.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
  if((Get-Service WdbService -ErrorAction SilentlyContinue).Status -ne 'Running' -or $binding.runtimeMode -ne 'with-node'){$null=Install-Exe with-node 'restore-with-node'}
  $report.finalService=(Get-Service WdbService).Status.ToString()
 }catch{$report.errors+=('Restore: '+$_.Exception.Message);$report.status='failed'}
 $report.endedAt=[DateTime]::UtcNow.ToString('o');Save-Report
 Get-Content -LiteralPath "$env:ProgramData\WdbInstaller\installer.log" -Tail 120 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'installer-internal.log') -Encoding UTF8
}
if($report.status -ne 'passed'){exit 1}
