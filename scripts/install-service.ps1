[CmdletBinding()]
param(
    [string]$InstallDirectory = "$env:ProgramFiles\wdb",
    [string]$DataDirectory = "$env:ProgramData\wdb",
    [string]$DesktopUser = '',
    [int]$Port = 18766,
    [int]$HelperPort = 18767,
    [switch]$Development
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this installer once from an administrator PowerShell (Windows UAC consent is required).' }
if (!$DesktopUser) { $DesktopUser = (Get-CimInstance Win32_ComputerSystem).UserName }
if (!$DesktopUser) { throw 'Specify -DesktopUser DOMAIN\User for an interactive desktop account.' }
if ($Port -lt 1024 -or $Port -gt 65535 -or $HelperPort -lt 1024 -or $HelperPort -gt 65535 -or $Port -eq $HelperPort) { throw 'Choose distinct server/helper ports in 1024..65535.' }
$sourceRoot = Split-Path $PSScriptRoot -Parent
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
New-Item -ItemType Directory -Force -Path $InstallDirectory, $DataDirectory, (Join-Path $DataDirectory 'logs') | Out-Null
$logPath = Join-Path $DataDirectory 'install.log'
Start-Transcript -Path $logPath -Append | Out-Null
try {
    $oldService = Get-Service -Name WdbService -ErrorAction SilentlyContinue
    if ($oldService -and $oldService.Status -ne 'Stopped') { Stop-Service WdbService -Force }
    $oldTask = Get-ScheduledTask -TaskName WdbDesktopHelper -ErrorAction SilentlyContinue
    if ($oldTask) { Stop-ScheduledTask -TaskName WdbDesktopHelper }
    $bundledHost = Join-Path $sourceRoot 'native\WdbServiceHost.exe'
    $bundledNode = Join-Path $sourceRoot 'runtime\node.exe'
    if (!(Test-Path -LiteralPath $bundledHost) -or !(Test-Path -LiteralPath $bundledNode)) {
        $bundleRoot = & (Join-Path $PSScriptRoot 'build.ps1') -HostOnly | Select-Object -Last 1
        $bundledHost = Join-Path $bundleRoot 'native\WdbServiceHost.exe'
        $bundledNode = Join-Path $bundleRoot 'runtime\node.exe'
    }
    $resolvedBundledNode = (& $bundledNode -p 'process.execPath').Trim()
    if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($resolvedBundledNode) -ne [IO.Path]::GetFullPath($bundledNode)) {
        throw 'Bundled node.exe is a version-manager shim or invalid runtime. Rebuild using scripts/build.ps1 before installation.'
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDirectory 'native'), (Join-Path $InstallDirectory 'runtime') | Out-Null
    if ($bundledHost -ne (Join-Path $InstallDirectory 'native\WdbServiceHost.exe')) { Copy-Item -LiteralPath $bundledHost -Destination (Join-Path $InstallDirectory 'native\WdbServiceHost.exe') -Force }
    if ($bundledNode -ne (Join-Path $InstallDirectory 'runtime\node.exe')) { Copy-Item -LiteralPath $bundledNode -Destination (Join-Path $InstallDirectory 'runtime\node.exe') -Force }
    $serverRoot = $InstallDirectory
    if ($Development) { $serverRoot = $sourceRoot; Write-Warning "Development install: SYSTEM executes source in $serverRoot. Keep this checkout protected." }
    else {
        foreach ($name in @('src','bin','scripts','skills','docs','package.json','README.md','wdb.cmd')) {
            $item = Join-Path $sourceRoot $name
            if ((Test-Path -LiteralPath $item) -and $sourceRoot -ne $InstallDirectory) { Copy-Item -LiteralPath $item -Destination $InstallDirectory -Recurse -Force }
        }
        Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'native') -File | Where-Object Name -ne 'WdbServiceHost.exe' | ForEach-Object {
            if ($_.FullName -ne (Join-Path $InstallDirectory "native\$($_.Name)")) { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $InstallDirectory 'native') -Force }
        }
        if (Test-Path -LiteralPath (Join-Path $sourceRoot 'runtime')) {
            Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'runtime') -File | Where-Object Name -ne 'node.exe' | ForEach-Object {
                if ($_.FullName -ne (Join-Path $InstallDirectory "runtime\$($_.Name)")) { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $InstallDirectory 'runtime') -Force }
            }
        }
    }
    $desktopSid = (New-Object Security.Principal.NTAccount($DesktopUser)).Translate([Security.Principal.SecurityIdentifier]).Value
    & icacls.exe $DataDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${desktopSid}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict data directory permissions.' }
    $secretPath = Join-Path $DataDirectory 'helper-secret'
    if (!(Test-Path -LiteralPath $secretPath)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
        [IO.File]::WriteAllText($secretPath, [Convert]::ToBase64String($bytes), (New-Object Text.UTF8Encoding($false)))
    }
    $initScript = Join-Path $serverRoot 'scripts\init-data.ps1'
    if (Test-Path -LiteralPath $initScript) { & $initScript -DataDir $DataDirectory }
    $hostExe = Join-Path $InstallDirectory 'native\WdbServiceHost.exe'
    $nodeExe = Join-Path $InstallDirectory 'runtime\node.exe'
    $serviceArgs = '"{0}" --node "{1}" --script "{2}" --data-dir "{3}" --port {4}' -f $hostExe, $nodeExe, (Join-Path $serverRoot 'src\server.js'), $DataDirectory, $Port
    if ($oldService) {
        & sc.exe config WdbService binPath= $serviceArgs start= auto | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Failed to update WdbService.' }
    } else { New-Service -Name WdbService -DisplayName 'Windows Debug Bridge' -Description 'Authenticated local Windows debugging bridge with isolated desktop helper.' -BinaryPathName $serviceArgs -StartupType Automatic | Out-Null }
    & sc.exe failure WdbService reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
    # Allow the paired local desktop account to start/stop/query this service,
    # without granting permission to change its executable or security descriptor.
    $serviceSddl = (& sc.exe sdshow WdbService | Where-Object { $_ -match '^D:' } | Select-Object -First 1).Trim()
    if ($serviceSddl -and $serviceSddl -notmatch [regex]::Escape($desktopSid)) {
        $ace = "(A;;CCLCSWRPWPDTLOCRRC;;;$desktopSid)"
        $saclIndex = $serviceSddl.IndexOf('S:')
        if ($saclIndex -ge 0) { $serviceSddl = $serviceSddl.Insert($saclIndex, $ace) } else { $serviceSddl += $ace }
        & sc.exe sdset WdbService $serviceSddl | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant service lifecycle access to the desktop user.' }
    }
    $helperArgs = '--helper --node "{0}" --script "{1}" --data-dir "{2}" --port {3}' -f $nodeExe, (Join-Path $serverRoot 'src\helper.js'), $DataDirectory, $HelperPort
    $action = New-ScheduledTaskAction -Execute $hostExe -Argument $helperArgs -WorkingDirectory $serverRoot
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $DesktopUser -LogonType Interactive -RunLevel Limited
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $DesktopUser
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden
    Register-ScheduledTask -TaskName WdbDesktopHelper -Action $action -Principal $taskPrincipal -Trigger $trigger -Settings $settings -Description 'wdb interactive-session desktop bridge; never runs as SYSTEM.' -Force | Out-Null
    [ordered]@{ installedAt = [DateTime]::UtcNow.ToString('o'); installDirectory = $InstallDirectory; dataDirectory = $DataDirectory; serverRoot = $serverRoot; desktopUser = $DesktopUser; port = $Port; helperPort = $HelperPort; development = [bool]$Development } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataDirectory 'installation.json') -Encoding UTF8
    Start-Service WdbService
    Start-ScheduledTask -TaskName WdbDesktopHelper
    Write-Output "Installed WdbService and WdbDesktopHelper. Data: $DataDirectory; localhost:$Port."
    Get-Service WdbService | Select-Object Name, Status
} finally { Stop-Transcript | Out-Null }
