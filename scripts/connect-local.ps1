param([string]$DataDirectory = "$env:ProgramData\wdb", [string]$ConfigDirectory = "$env:LOCALAPPDATA\wdb\client", [string]$Target = '127.0.0.1:18766')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
# DataDirectory remains accepted for compatibility; connection needs only the target.
& (Join-Path $root 'bin\wdb.cmd') connect $Target --config $ConfigDirectory --json
exit $LASTEXITCODE
