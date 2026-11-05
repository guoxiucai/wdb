[CmdletBinding()]
param([string]$DataDirectory = "$env:ProgramData\wdb", [switch]$RemoveData)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Uninstall requires administrator PowerShell.' }
$service = Get-Service WdbService -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') { Stop-Service WdbService -Force }
    & sc.exe delete WdbService | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to delete WdbService.' }
}
$task = Get-ScheduledTask WdbDesktopHelper -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask WdbDesktopHelper; Unregister-ScheduledTask WdbDesktopHelper -Confirm:$false }
if ($RemoveData) {
    $resolved = [IO.Path]::GetFullPath($DataDirectory).TrimEnd('\')
    $expected = [IO.Path]::GetFullPath("$env:ProgramData\wdb").TrimEnd('\')
    if ($resolved -ne $expected) { throw "Automatic removal is restricted to $expected; remove custom data directories manually." }
    if ((Split-Path $resolved -Leaf) -ne 'wdb') { throw 'Unsafe removal target.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
Write-Output 'wdb service and desktop task removed. Installation files remain; configuration and pairing are preserved unless -RemoveData was specified.'
