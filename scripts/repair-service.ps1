[CmdletBinding()]
param([switch]$Development, [string]$DataDirectory = "$env:ProgramData\wdb")
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$installer = Join-Path $PSScriptRoot 'install-service.ps1'
# Prepare the concrete offline payload before stopping anything or requesting
# consent. The elevated installer then needs no per-user NVM configuration.
if (!$Development -and (!(Test-Path -LiteralPath (Join-Path $sourceRoot 'runtime\node.exe')) -or !(Test-Path -LiteralPath (Join-Path $sourceRoot 'native\WdbServiceHost.exe')))) {
    $preparedRoot = & (Join-Path $PSScriptRoot 'build.ps1') | Select-Object -Last 1
    $installer = Join-Path $preparedRoot 'scripts\install-service.ps1'
}
# This script is deliberately invoked by the user when available to approve UAC.
# It uses the ordinary Windows administrator-consent flow and never stores a password.
$argsText = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -DataDirectory "{1}"' -f $installer,[IO.Path]::GetFullPath($DataDirectory).TrimEnd('\')
if ($Development) { $argsText += ' -Development' }
Write-Output 'Stopping only verified wdb fallback processes, then requesting normal Windows UAC consent to repair WdbService.'
$hadFallback = Test-Path -LiteralPath (Join-Path $DataDirectory 'local-processes.json')
& (Join-Path $PSScriptRoot 'stop-local.ps1') -DataDirectory $DataDirectory
try {
    $process = Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -WindowStyle Hidden -ArgumentList $argsText -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Repair failed with exit code $($process.ExitCode); read $DataDirectory\install.log." }
} catch {
    $repairError = $_
    if ($hadFallback) {
        Write-Warning 'Repair did not complete; restoring the ordinary-user fallback when its ports are free.'
        try { & (Join-Path $PSScriptRoot 'start-local.ps1') -DataDirectory $DataDirectory }
        catch { Write-Warning "Fallback restore was not possible: $($_.Exception.Message)" }
    }
    throw $repairError
}
& (Join-Path $PSScriptRoot 'service.ps1') status -DataDirectory $DataDirectory
