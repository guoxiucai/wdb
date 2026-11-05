param([string]$DataDirectory = "$env:ProgramData\wdb", [string]$ConfigDirectory = "$env:LOCALAPPDATA\wdb\client", [string]$Target = '127.0.0.1:18766')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$fingerprint = [IO.File]::ReadAllText((Join-Path $DataDirectory 'fingerprint')).Trim()
$pairingCode = [IO.File]::ReadAllText((Join-Path $DataDirectory 'pairing-code')).Trim()
& (Join-Path $root 'bin\wdb.cmd') connect $Target --config $ConfigDirectory --fingerprint $fingerprint --pairing-code $pairingCode --json
exit $LASTEXITCODE
