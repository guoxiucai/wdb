[CmdletBinding()]
param([string]$DataDirectory = "$env:ProgramData\wdb")
$ErrorActionPreference = 'Stop'
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory).TrimEnd('\')
$pidFile = Join-Path $DataDirectory 'local-processes.json'
if (!(Test-Path -LiteralPath $pidFile)) { Write-Output 'No background processes registered by start-local.ps1; no processes stopped.'; return }
function Read-ProcessRecords($Value) {
    foreach ($entry in $Value) {
        if ($entry.role -and $entry.pid) { $entry }
        elseif ($entry.value) { Read-ProcessRecords $entry.value }
    }
}
$parsedRecords = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
$records = @(Read-ProcessRecords $parsedRecords)
$results = @()
foreach ($record in ($records | Sort-Object role -Descending)) {
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if (!$process) { $results += @{ pid = $record.pid; status = 'already-exited' }; continue }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($record.pid)"
    # Windows PowerShell keeps JSON dates as strings; PowerShell 7.5+ may parse
    # them to DateTime. Compare ticks so both hosts preserve PID-reuse protection.
    $recordedStart = if ($record.startedAt -is [DateTime]) { $record.startedAt.ToUniversalTime() } else { [DateTime]::Parse($record.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() }
    $sameStart = $process.StartTime.ToUniversalTime().Ticks -eq $recordedStart.Ticks
    $sameExecutable = $details.ExecutablePath -eq $record.executable
    $sameCommand = $details.CommandLine -like "*$($record.script)*" -and $details.CommandLine -like "*$DataDirectory*"
    if (!$sameStart -or !$sameExecutable -or !$sameCommand -or $record.dataDirectory -ne $DataDirectory) { throw "PID $($record.pid) no longer matches its recorded wdb process; refusing to stop it." }
    & taskkill.exe /PID $record.pid /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not stop managed wdb process $($record.pid)." }
    $results += @{ pid = $record.pid; status = 'stopped'; role = $record.role }
}
Remove-Item -LiteralPath $pidFile
ConvertTo-Json -InputObject @($results) -Depth 4
