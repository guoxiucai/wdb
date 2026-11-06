[CmdletBinding()]
param([string]$DataDirectory = "$env:ProgramData\wdb", [switch]$RevealCode)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $DataDirectory 'config.json') -Raw | ConvertFrom-Json
$installation = Get-Content -LiteralPath (Join-Path $DataDirectory 'installation.json') -Raw | ConvertFrom-Json
$result = [ordered]@{
    hostname = $env:COMPUTERNAME
    deviceId = $config.deviceId
    port = $installation.port
    fingerprint = (Get-Content -LiteralPath (Join-Path $DataDirectory 'fingerprint') -Raw).Trim()
    addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object IPAddress, InterfaceAlias)
}
if ($RevealCode) { $result['pairingCode'] = (Get-Content -LiteralPath (Join-Path $DataDirectory 'pairing-code') -Raw).Trim() }
$result | ConvertTo-Json -Depth 5
