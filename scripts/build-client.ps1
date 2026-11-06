[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
if (!$OutputDirectory) { $OutputDirectory = Join-Path $sourceRoot 'dist\wdb-client-windows-x64' }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
foreach ($directory in @('src','bin','runtime','scripts','docs','skills')) { New-Item -ItemType Directory -Path (Join-Path $outputRoot $directory) -Force | Out-Null }
$node = (& node.exe -p 'process.execPath').Trim()
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $node)) { throw 'An actual Node runtime is required.' }
Copy-Item -LiteralPath $node -Destination (Join-Path $outputRoot 'runtime\node.exe') -Force
$license = Join-Path (Split-Path $node -Parent) 'LICENSE'
if (!(Test-Path -LiteralPath $license)) { $license = Join-Path $sourceRoot '.runtime\NODE-LICENSE.txt' }
Copy-Item -LiteralPath $license -Destination (Join-Path $outputRoot 'runtime\NODE-LICENSE.txt') -Force
foreach ($file in @('cli.js','client-transport.js','device-id.js','client-stream.js','stream-channel.js','stream-flow.js','stream-protocol.js','stream-tcp.js','forward-client.js','terminal-client.js')) { Copy-Item -LiteralPath (Join-Path $sourceRoot "src\$file") -Destination (Join-Path $outputRoot 'src') -Force }
& node.exe (Join-Path $PSScriptRoot 'copy-ws.js') $outputRoot
if($LASTEXITCODE -ne 0){throw 'WebSocket dependency staging failed'}
Copy-Item -LiteralPath (Join-Path $sourceRoot 'package.json') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'bin\wdb.cmd') -Destination (Join-Path $outputRoot 'bin') -Force
foreach ($file in @('verify-package.ps1','validate-lan.js')) { Copy-Item -LiteralPath (Join-Path $sourceRoot "scripts\$file") -Destination (Join-Path $outputRoot 'scripts') -Force }
Copy-Item -LiteralPath (Join-Path $sourceRoot 'skills\wdb') -Destination (Join-Path $outputRoot 'skills') -Recurse -Force
Copy-Item -Path (Join-Path $sourceRoot 'docs\*.md') -Destination (Join-Path $outputRoot 'docs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'docs\WINDOWS-CLIENT.md') -Destination (Join-Path $outputRoot 'README.md') -Force
. (Join-Path $PSScriptRoot 'package-metadata.ps1')
Write-WdbPackageMetadata -SourceRoot $sourceRoot -OutputRoot $outputRoot -Kind Client -Node (Join-Path $outputRoot 'runtime\node.exe')
$manifest = Get-ChildItem -LiteralPath $outputRoot -Recurse -File | Where-Object Name -ne 'SHA256SUMS.txt' | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.FullName.Substring($outputRoot.Length + 1)
}
$manifest | Set-Content -LiteralPath (Join-Path $outputRoot 'SHA256SUMS.txt') -Encoding UTF8
& (Join-Path $PSScriptRoot 'verify-package.ps1') -PackageDirectory $outputRoot -Kind Client
