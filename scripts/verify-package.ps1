[CmdletBinding()]
param([string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
if (!$PackageDirectory) { $PackageDirectory = Join-Path $PSScriptRoot '..\dist\wdb-windows-x64' }
$packageRoot = [IO.Path]::GetFullPath($PackageDirectory).TrimEnd('\')
$prefix = $packageRoot + '\'
$manifest = Join-Path $packageRoot 'SHA256SUMS.txt'
if (!(Test-Path -LiteralPath $manifest)) { throw 'Package checksum manifest is missing.' }
$verified = @{}
foreach ($line in (Get-Content -LiteralPath $manifest)) {
    if (!$line.Trim()) { continue }
    if ($line -notmatch '^([a-fA-F0-9]{64})  (.+)$') { throw "Invalid checksum entry: $line" }
    $expected = $matches[1]
    $relative = $matches[2]
    $file = [IO.Path]::GetFullPath((Join-Path $packageRoot $relative))
    if (!$file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Manifest entry escapes package: $relative" }
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Package file missing: $relative" }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch: $relative" }
    $verified[$file] = $true
}
foreach ($file in (Get-ChildItem -LiteralPath $packageRoot -Recurse -File)) {
    if ($file.Name -ne 'SHA256SUMS.txt' -and !$verified.ContainsKey($file.FullName)) { throw "Unlisted package file: $($file.FullName)" }
}
foreach ($required in @('runtime\node.exe','runtime\NODE-LICENSE.txt','runtime\ffmpeg.exe','runtime\ffprobe.exe','runtime\FFMPEG-LICENSE','native\WdbServiceHost.exe','native\bin\DesktopBridge.exe','bin\wdb.cmd','src\server.js','src\helper.js','scripts\install-service.ps1','scripts\service-config.ps1')) {
    if (!(Test-Path -LiteralPath (Join-Path $packageRoot $required))) { throw "Required offline component missing: $required" }
}
$node = Join-Path $packageRoot 'runtime\node.exe'
$actualNode = (& $node -p 'process.execPath').Trim()
if ($LASTEXITCODE -ne 0 -or $actualNode -ne $node) { throw 'Packaged Node is not an independent runtime.' }
$cliVersion = & $node (Join-Path $packageRoot 'src\cli.js') --version --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $cliVersion.status -ne 'succeeded') { throw 'Packaged CLI could not start.' }
[ordered]@{ status = 'verified'; packageDirectory = $packageRoot; verifiedFiles = $verified.Count; cliVersion = $cliVersion.data.version; runtime = $actualNode } | ConvertTo-Json
