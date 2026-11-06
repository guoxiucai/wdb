[CmdletBinding()]
param(
 [ValidateSet('Preflight','Begin','Commit','Finish','Rollback','Install','Uninstall')][string]$Action,
 [string]$SourceDirectory,
 [string]$InstallDirectory="$env:ProgramFiles\wdb",[string]$DataDirectory="$env:ProgramData\wdb",
 [string]$DesktopUser,[string]$NodePath,[string]$RuntimeMode,[string]$ListenAddress,
 [int]$Port=18766,[int]$HelperPort=18767
)
$ErrorActionPreference='Stop'
# Windows PowerShell 5.1 advanced-script parameter defaults can run before
# PSScriptRoot is initialized. Resolve the default after parameter binding.
if(!$SourceDirectory){$SourceDirectory=Split-Path $PSScriptRoot -Parent}
. (Join-Path $PSScriptRoot 'payload-common.ps1')
. (Join-Path $PSScriptRoot 'resolve-node.ps1')
. (Join-Path $PSScriptRoot 'service-config.ps1')
$admin=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run the installer with normal Windows administrator consent.'}
$InstallDirectory=[IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$DataDirectory=[IO.Path]::GetFullPath($DataDirectory).TrimEnd('\')
$SourceDirectory=[IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\')
# One product/SCM identity. Restrict program writes and rollback to its fixed root.
if($InstallDirectory -ine [IO.Path]::GetFullPath("$env:ProgramFiles\wdb")){throw 'This installer uses the fixed Program Files\wdb product directory.'}
if($DataDirectory -ine [IO.Path]::GetFullPath("$env:ProgramData\wdb")){throw 'This installer preserves the fixed ProgramData\wdb data directory.'}
$transactionRoot=Join-Path $env:ProgramData 'WdbInstaller'
$stateFile=Join-Path $transactionRoot 'active.json'
New-Item -ItemType Directory -Path $transactionRoot -Force | Out-Null
& icacls.exe $transactionRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Cannot protect installer diagnostics'}
$installerLog=Join-Path $transactionRoot 'installer.log'
[IO.File]::AppendAllText($installerLog,([DateTime]::UtcNow.ToString('o')+" $Action begin`r`n"))
function Save-State($State){$State | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $stateFile -Encoding UTF8}
function Read-State {
 $state=Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
 if($state.installDirectory -ine $InstallDirectory -or $state.dataDirectory -ine $DataDirectory){throw 'Transaction path mismatch'}
 $backup=[IO.Path]::GetFullPath($state.backup)
 if((Split-Path $backup -Parent) -ine $transactionRoot -or (Split-Path $backup -Leaf) -notmatch '^backup-[a-f0-9-]{36}$'){throw 'Unsafe rollback location'}
 return $state
}
function Stop-Wdb {
 $service=Get-Service WdbService -ErrorAction SilentlyContinue
 if($service -and $service.Status -ne 'Stopped'){Stop-Service WdbService -Force;$service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))}
 $task=Get-ScheduledTask -TaskName WdbDesktopHelper -ErrorAction SilentlyContinue
 if($task){
  $hosts=@(Get-CimInstance Win32_Process -Filter "Name='WdbServiceHost.exe'" | Where-Object {$_.ExecutablePath -ieq (Join-Path $InstallDirectory 'native\WdbServiceHost.exe') -and $_.CommandLine -like '*--helper*'})
  foreach($hostProcess in $hosts){& taskkill.exe /PID $hostProcess.ProcessId /T /F | Out-Null}
  Stop-ScheduledTask -TaskName WdbDesktopHelper
 }
}
function Preflight {
 if(![Environment]::Is64BitOperatingSystem -or ![Environment]::Is64BitProcess){throw 'A 64-bit Windows installer process is required'}
 $os=Get-CimInstance Win32_OperatingSystem
 if([int]$os.BuildNumber -lt 19045 -or $os.ProductType -ne 1){throw 'Requires Windows desktop build 19045 or later; Server Core is not supported.'}
 if($PSVersionTable.PSVersion -lt [version]'5.1'){throw 'Windows PowerShell 5.1 is required'}
 $net=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full'
 if($net.Release -lt 528040){throw '.NET Framework 4.8 or later is required'}
 foreach($dll in @('UIAutomationClient.dll','UIAutomationTypes.dll','WindowsBase.dll')){if(!(Test-Path -LiteralPath "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\$dll")){throw "Desktop component missing: $dll"}}
 $info=Test-WdbPayload $SourceDirectory -Installed:($SourceDirectory -ieq $InstallDirectory)
 if($RuntimeMode -and $RuntimeMode -ne $info.runtimeMode){throw 'Selected runtime mode differs from installer payload'}
 $script:RuntimeMode=$info.runtimeMode
 if(!$DesktopUser){throw 'Specify the actual desktop account using /DESKTOPUSER="DOMAIN\User" or -DesktopUser. It is never inferred from the elevated installer identity.'}
 $null=(New-Object Security.Principal.NTAccount($DesktopUser)).Translate([Security.Principal.SecurityIdentifier])
 if($Port -lt 1024 -or $Port -gt 65535 -or $HelperPort -lt 1024 -or $HelperPort -gt 65535 -or $Port -eq $HelperPort){throw 'Invalid or conflicting service/helper ports'}
 $existing=Get-CimInstance Win32_Service -Filter "Name='WdbService'"
 if($existing -and !$existing.PathName.StartsWith('"'+(Join-Path $InstallDirectory 'native\WdbServiceHost.exe')+'"',[StringComparison]::OrdinalIgnoreCase)){throw 'Existing WdbService belongs to a different installation; refusing to overwrite it.'}
 foreach($listener in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @($Port,$HelperPort)})){
  $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if(!$process -or $process.CommandLine -notlike "*$InstallDirectory\src\*" -or $process.CommandLine -notlike "*$DataDirectory*"){throw "Port $($listener.LocalPort) is already in use by another process"}
 }
 $script:runtime=Resolve-WdbNode -RuntimeMode $script:RuntimeMode -InstallDirectory $SourceDirectory -NodePath $NodePath -BuildPayload:($script:RuntimeMode -eq 'with-node')
 $oldFile=Join-Path $DataDirectory 'installation.json'
 if(Test-Path -LiteralPath $oldFile){$previous=Get-Content -LiteralPath $oldFile -Raw | ConvertFrom-Json;if(!$ListenAddress){$script:ListenAddress=$previous.listenAddress};$script:Port=[int]$previous.port;$script:HelperPort=[int]$previous.helperPort}
 if(!$ListenAddress){$script:ListenAddress='127.0.0.1'}
 $parsed=$null;if(![Net.IPAddress]::TryParse($script:ListenAddress,[ref]$parsed)){throw 'ListenAddress must be a numeric IP address'}
 $required=([int64]((Get-WdbPayloadFiles $SourceDirectory | Measure-Object Length -Sum).Sum)*3)+100MB
 $drive=Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='{0}'" -f [IO.Path]::GetPathRoot($InstallDirectory).TrimEnd('\'))
 if($drive.FreeSpace -lt $required){throw "Insufficient disk space; require $required bytes for staging and rollback"}
 [ordered]@{status='preflight-passed';runtimeMode=$script:RuntimeMode;node=$script:runtime.path;version=$info.version;desktopUser=$DesktopUser;windowsBuild=$os.BuildNumber;netFrameworkRelease=$net.Release} | ConvertTo-Json
}
function Begin-Install {
 Preflight
 New-Item -ItemType Directory -Path $transactionRoot -Force | Out-Null
 & icacls.exe $transactionRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Cannot protect installer transaction directory'}
 if(Test-Path -LiteralPath $stateFile){$prior=Read-State;if($prior.phase -notin @('finished','rolled-back')){throw 'An unfinished installation exists. Run installer-action.ps1 -Action Rollback before retrying.'}}
 $backup=Join-Path $transactionRoot ('backup-'+[guid]::NewGuid().ToString())
 New-Item -ItemType Directory -Path $backup -Force | Out-Null
 $service=Get-CimInstance Win32_Service -Filter "Name='WdbService'"
 $task=Get-ScheduledTask -TaskName WdbDesktopHelper -ErrorAction SilentlyContinue
 # Get-Content strings carry provider/drive metadata in Windows PowerShell 5.1.
 # Serializing those at depth 12 can traverse a very large object graph. Store
 # plain .NET strings, never provider-adorned values, in the transaction record.
 $state=[ordered]@{phase='prepared';installDirectory=$InstallDirectory;dataDirectory=$DataDirectory;backup=$backup;sourceDirectory=$SourceDirectory;newFiles=@((Get-WdbPayloadFiles $SourceDirectory).FullName | ForEach-Object {$_.Substring($SourceDirectory.Length+1)});oldService=$(if($service){@{binary=$service.PathName;running=$service.State -eq 'Running'}}else{$null});oldHelper=$(if($task){(Export-ScheduledTask -TaskName WdbDesktopHelper).ToString()}else{$null});oldInstallation=$(if(Test-Path -LiteralPath (Join-Path $DataDirectory 'installation.json')){[IO.File]::ReadAllText((Join-Path $DataDirectory 'installation.json'))}else{$null});oldFirewallProgram=$null;oldFiles=@();runtimeMode=$script:RuntimeMode;nodePath=$script:runtime.path;desktopUser=$DesktopUser;listenAddress=$script:ListenAddress;port=$script:Port;helperPort=$script:HelperPort}
 $rule=Get-NetFirewallRule -Name WdbService-LAN -ErrorAction SilentlyContinue
 if($rule){$state.oldFirewallProgram=($rule | Get-NetFirewallApplicationFilter).Program}
 $state.newFiles+= 'PAYLOAD-SHA256SUMS.txt'
 foreach($manifest in @('PAYLOAD-SHA256SUMS.txt','SHA256SUMS.txt')){
  $file=Join-Path $InstallDirectory $manifest
  if(Test-Path -LiteralPath $file){$state.oldFiles+=@(Get-Content -LiteralPath $file | ForEach-Object {if($_ -match '^[a-fA-F0-9]{64}  (.+)$'){$matches[1]}});$state.oldFiles+=$manifest;break}
 }
 Save-State $state
 try{
  Stop-Wdb
  if(Test-Path -LiteralPath $InstallDirectory){
   foreach($file in Get-WdbPayloadFiles $InstallDirectory){$relative=$file.FullName.Substring($InstallDirectory.Length+1);$dest=Join-Path $backup $relative;New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null;Copy-Item -LiteralPath $file.FullName -Destination $dest -Force}
   $oldManifest=Join-Path $InstallDirectory 'PAYLOAD-SHA256SUMS.txt';if(Test-Path -LiteralPath $oldManifest){Copy-Item -LiteralPath $oldManifest -Destination $backup}
  }
  $state.phase='files-ready';Save-State $state
 }catch{Rollback-Install;throw}
}
function Commit-Install {
 $state=Read-State;if($state.phase -ne 'files-ready'){throw 'Files were not prepared for commit'}
 # Check only manifest-listed files here: obsolete files are retained until the
 # new service is healthy, then removed according to the previous owned list.
 foreach($line in Get-Content -LiteralPath (Join-Path $InstallDirectory 'PAYLOAD-SHA256SUMS.txt')){if($line -match '^([a-f0-9]{64})  (.+)$'){$file=[IO.Path]::GetFullPath((Join-Path $InstallDirectory $matches[2]));if(!$file.StartsWith($InstallDirectory+'\',[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $matches[1]){throw 'Installed payload integrity mismatch'}}}
 $runtime=Resolve-WdbNode -RuntimeMode $state.runtimeMode -InstallDirectory $InstallDirectory -NodePath $state.nodePath
 & (Join-Path $InstallDirectory 'scripts\register-service.ps1') -InstallDirectory $InstallDirectory -DataDirectory $DataDirectory -DesktopUser $state.desktopUser -Port $state.port -HelperPort $state.helperPort -ListenAddress $state.listenAddress -Runtime $runtime
 foreach($relative in $state.oldFiles){
  if($relative.Replace('/','\') -in @($state.newFiles | ForEach-Object {$_.Replace('/','\')})){continue}
  $file=[IO.Path]::GetFullPath((Join-Path $InstallDirectory $relative));if(!$file.StartsWith($InstallDirectory+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe old ownership manifest'}
  if(Test-Path -LiteralPath $file -PathType Leaf){Remove-Item -LiteralPath $file -Force}
 }
 # Legacy directory bundles had additional directories. Remove only empty ones;
 # never recursively delete user-created content or an arbitrary install path.
 foreach($directory in Get-ChildItem -LiteralPath $InstallDirectory -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending){if(!(Get-ChildItem -LiteralPath $directory.FullName -Force | Select-Object -First 1)){Remove-Item -LiteralPath $directory.FullName -Force}}
 $state.phase='committed';Save-State $state
}
function Rollback-Install {
 if(!(Test-Path -LiteralPath $stateFile)){return}
 $state=Read-State;if($state.phase -in @('finished','rolled-back')){return}
 Stop-Wdb
 if($state.phase -ne 'prepared'){
  foreach($relative in @($state.newFiles)+@('runtime-binding.json','installation-health.json')){
   $file=[IO.Path]::GetFullPath((Join-Path $InstallDirectory $relative));if(!$file.StartsWith($InstallDirectory+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe rollback file'}
   if(!(Test-Path -LiteralPath (Join-Path $state.backup $relative)) -and (Test-Path -LiteralPath $file -PathType Leaf)){Remove-Item -LiteralPath $file -Force}
  }
  foreach($file in Get-ChildItem -LiteralPath $state.backup -Recurse -File){$relative=$file.FullName.Substring($state.backup.Length+1);$dest=Join-Path $InstallDirectory $relative;if((Test-Path -LiteralPath $dest -PathType Leaf) -and (Get-FileHash -LiteralPath $file.FullName).Hash -eq (Get-FileHash -LiteralPath $dest).Hash){continue};New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null;Copy-Item -LiteralPath $file.FullName -Destination $dest -Force}
 }
 if($state.oldInstallation){[IO.File]::WriteAllText((Join-Path $DataDirectory 'installation.json'),$state.oldInstallation,(New-Object Text.UTF8Encoding($false)))}
 if($state.oldService){Set-WdbServiceConfiguration -BinaryPath $state.oldService.binary;if($state.oldService.running){Start-Service WdbService}}
 elseif(Get-Service WdbService -ErrorAction SilentlyContinue){& sc.exe delete WdbService | Out-Null}
 if($state.oldHelper){Register-ScheduledTask -TaskName WdbDesktopHelper -Xml $state.oldHelper -Force | Out-Null;Start-ScheduledTask -TaskName WdbDesktopHelper}
 elseif(Get-ScheduledTask -TaskName WdbDesktopHelper -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName WdbDesktopHelper -Confirm:$false}
 if($state.oldFirewallProgram){Get-NetFirewallRule -Name WdbService-LAN -ErrorAction SilentlyContinue | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program $state.oldFirewallProgram | Out-Null}
 else{Get-NetFirewallRule -Name WdbService-LAN -ErrorAction SilentlyContinue | Remove-NetFirewallRule}
 $state.phase='rolled-back';Save-State $state
 Write-Output 'Prior program and runtime binding restored; user data retained.'
}
try {
 switch($Action){
  'Preflight' {Preflight}
  'Begin' {Begin-Install}
  'Commit' {Commit-Install}
  'Finish' {$state=Read-State;if($state.phase -ne 'committed'){throw 'Installation not committed'};$state.phase='finished';Save-State $state}
  'Rollback' {Rollback-Install}
  'Install' {
   Begin-Install
   try{if($SourceDirectory -ine $InstallDirectory){foreach($file in Get-ChildItem -LiteralPath $SourceDirectory -Recurse -File){$relative=$file.FullName.Substring($SourceDirectory.Length+1);$dest=Join-Path $InstallDirectory $relative;New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null;Copy-Item -LiteralPath $file.FullName -Destination $dest -Force}};Commit-Install;$state=Read-State;$state.phase='finished';Save-State $state}catch{Rollback-Install;throw}
  }
  'Uninstall' {Stop-Wdb;& (Join-Path $PSScriptRoot 'uninstall-service.ps1') -DataDirectory $DataDirectory}
 }
 [IO.File]::AppendAllText($installerLog,([DateTime]::UtcNow.ToString('o')+" $Action succeeded`r`n"))
} catch { $message="WDB installer ${Action}: $($_.Exception.Message)";[IO.File]::AppendAllText($installerLog,([DateTime]::UtcNow.ToString('o')+' '+$message+"`r`n"+$_.ScriptStackTrace+"`r`n"));Write-Error $message -ErrorAction Continue;exit 1 }
