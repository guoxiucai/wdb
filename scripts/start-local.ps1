[CmdletBinding()]
param([string]$DataDirectory = "$env:ProgramData\wdb", [int]$Port = 18766, [int]$HelperPort = 18767)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory).TrimEnd('\')
$nodePath = Join-Path $sourceRoot 'runtime\node.exe'
if (!(Test-Path -LiteralPath $nodePath)) { $nodePath = (& node.exe -p 'process.execPath').Trim() }
if (!(Test-Path -LiteralPath $nodePath)) { throw 'A real Node runtime is required. Build the offline bundle or install Node on this development machine.' }
if (!(Test-Path -LiteralPath (Join-Path $DataDirectory 'tls.pfx'))) { & (Join-Path $PSScriptRoot 'init-data.ps1') -DataDir $DataDirectory }
$logs = Join-Path $DataDirectory 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$pidFile = Join-Path $DataDirectory 'local-processes.json'
$processes = @()
function Read-ProcessRecords($Value) {
    foreach ($entry in $Value) {
        if ($entry.role -and $entry.pid) { $entry }
        elseif ($entry.value) { Read-ProcessRecords $entry.value }
    }
}
if (Test-Path -LiteralPath $pidFile) { $parsedRecords = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json; $processes = @(Read-ProcessRecords $parsedRecords) }
function Test-LocalPort([int]$ListenPort) {
    $probe = New-Object Net.Sockets.TcpClient
    try { $probe.Connect('127.0.0.1', $ListenPort); return $true } catch { return $false } finally { $probe.Dispose() }
}
function Start-LocalComponent([string]$Role, [string]$Script, [int]$ListenPort) {
    if (Test-LocalPort $ListenPort) {
        $owners = @(Get-NetTCPConnection -LocalPort $ListenPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
        $existing = $null
        foreach ($ownerPid in $owners) {
            $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid"
            if ($candidate.CommandLine -like "*$Script*" -and $candidate.CommandLine -like "*$DataDirectory*") { $existing = $candidate; break }
        }
        if (!$existing) { throw "Port $ListenPort is occupied by an unverified process; no process was changed." }
        return [ordered]@{ role = $Role; status = 'already-running'; pid = $existing.ProcessId; managedByThisScript = [bool]($script:processes | Where-Object pid -eq $existing.ProcessId) }
    }
    $arguments = '"{0}" --data-dir "{1}" --host 127.0.0.1 --port {2} --helper-port {3}' -f $Script,$DataDirectory,$ListenPort,$HelperPort
    $process = Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $sourceRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs "local-$Role.stdout.log") -RedirectStandardError (Join-Path $logs "local-$Role.stderr.log")
    $record = [ordered]@{ role = $Role; pid = $process.Id; executable = $nodePath; script = $Script; dataDirectory = $DataDirectory; startedAt = $process.StartTime.ToUniversalTime().ToString('o') }
    $script:processes = @($script:processes | Where-Object role -ne $Role) + @($record)
    ConvertTo-Json -InputObject @($script:processes) -Depth 5 | Set-Content -LiteralPath $pidFile -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { throw "$Role exited $($process.ExitCode). Read $logs\local-$Role.stderr.log." }
        $ready = Test-LocalPort $ListenPort
        if ($ready) {
            Start-Sleep -Milliseconds 250
            $process.Refresh()
            if ($process.HasExited) { throw "$Role exited after startup, possibly because another helper/service already owns the port. Read $logs\local-$Role.stderr.log." }
            break
        }
        Start-Sleep -Milliseconds 100
    }
    if (!$ready) { throw "$Role did not open localhost:$ListenPort. Read the local logs." }
    return [ordered]@{ role = $Role; status = 'started'; pid = $process.Id; managedByThisScript = $true }
}
$helper = Start-LocalComponent 'helper' (Join-Path $sourceRoot 'src\helper.js') $HelperPort
$server = Start-LocalComponent 'server' (Join-Path $sourceRoot 'src\server.js') $Port
$processes = @($processes | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue })
ConvertTo-Json -InputObject @($processes) -Depth 5 | Set-Content -LiteralPath $pidFile -Encoding UTF8
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
[ordered]@{ mode = 'current-user-background'; windowsServiceVerified = $false; isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); note = 'Temporary local development mode. This does not repair or verify the SYSTEM Windows service; administrator commands require an elevated service.'; server = $server; helper = $helper; dataDirectory = $DataDirectory } | ConvertTo-Json -Depth 5
