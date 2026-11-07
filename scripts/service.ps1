[CmdletBinding()]
param([ValidateSet('start','stop','restart','status','diagnose')][string]$Action = 'status', [string]$DataDirectory = "$env:ProgramData\wdb")
$ErrorActionPreference = 'Stop'
switch ($Action) {
    'start' { Start-Service WdbService; Start-ScheduledTask -TaskName WdbDesktopHelper }
    'stop' { Stop-Service WdbService; Stop-ScheduledTask -TaskName WdbDesktopHelper }
    'restart' { Restart-Service WdbService; Stop-ScheduledTask -TaskName WdbDesktopHelper; Start-ScheduledTask -TaskName WdbDesktopHelper }
}
$service = Get-CimInstance Win32_Service -Filter "Name='WdbService'" -ErrorAction SilentlyContinue
$task = Get-ScheduledTask -TaskName WdbDesktopHelper -ErrorAction SilentlyContinue
$info = Get-ScheduledTaskInfo -TaskName WdbDesktopHelper -ErrorAction SilentlyContinue
$result = [ordered]@{
    service = $(if ($service) { [ordered]@{ name = $service.Name; state = $service.State; startMode = $service.StartMode; identity = $service.StartName; processId = $service.ProcessId; binary = $service.PathName } } else { $null })
    helper = $(if ($task) { [ordered]@{ name = $task.TaskName; state = [string]$task.State; user = $task.Principal.UserId; runLevel = [string]$task.Principal.RunLevel; lastResult = $info.LastTaskResult } } else { $null })
    dataDirectory = $DataDirectory
}
if ($Action -eq 'diagnose') {
    . (Join-Path $PSScriptRoot 'resolve-node.ps1')
    try { $result['runtime'] = Get-WdbRuntimeBinding -InstallDirectory "$env:ProgramFiles\wdb" }
    catch { $result['runtime'] = @{status='invalid';error=$_.Exception.Message;requiredVersion='>=22.0.0';repair='Run the matching Setup.exe or repair-service.ps1 -NodePath <system Node>'} }
    $result['os'] = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture
    $result['listeners'] = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in @(18766,18767) | Select-Object LocalAddress,LocalPort,OwningProcess)
    $result['logs'] = @{}
    foreach ($name in @('service-host.log','helper-host.log')) {
        $path = Join-Path $DataDirectory "logs\$name"
        # Windows PowerShell 5.1 may serialize Get-Content provider metadata
        # recursively. Diagnostics must use plain strings, especially when the
        # bound runtime is unavailable and recovery depends on this command.
        if (Test-Path -LiteralPath $path) { $result.logs[$name] = @([IO.File]::ReadAllLines($path) | Select-Object -Last 40) }
    }
}
$result | ConvertTo-Json -Depth 8
