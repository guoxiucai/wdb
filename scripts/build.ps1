[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist\wdb-windows-x64'), [switch]$HostOnly)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputRoot, (Join-Path $outputRoot 'runtime'), (Join-Path $outputRoot 'native') | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required on the build machine.' }
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /r:System.ServiceProcess.dll "/out:$(Join-Path $outputRoot 'native\WdbServiceHost.exe')" (Join-Path $sourceRoot 'native\ServiceHost.cs')
if ($LASTEXITCODE -ne 0) { throw "C# compiler failed: $LASTEXITCODE" }
$nodePath = (& node.exe -p 'process.execPath').Trim()
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $nodePath)) { throw 'Could not resolve the actual Node runtime (a version-manager shim cannot be bundled).' }
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $outputRoot 'runtime\node.exe') -Force
if (!$HostOnly) {
    foreach ($name in @('src','bin','scripts','skills','docs','native','package.json','README.md','wdb.cmd','wdb-phase1-requirements.md')) {
        $item = Join-Path $sourceRoot $name
        if (Test-Path -LiteralPath $item) { Copy-Item -LiteralPath $item -Destination $outputRoot -Recurse -Force }
    }
    $nodeLicense = Join-Path (Split-Path $nodePath -Parent) 'LICENSE'
    if (!(Test-Path -LiteralPath $nodeLicense)) { $nodeLicense = Join-Path $sourceRoot '.runtime\NODE-LICENSE.txt' }
    if (Test-Path -LiteralPath $nodeLicense) { Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $outputRoot 'runtime\NODE-LICENSE.txt') -Force }
    $ffmpegRoot = Join-Path $sourceRoot '.runtime\ffmpeg'
    if (Test-Path -LiteralPath $ffmpegRoot) {
        Get-ChildItem -LiteralPath $ffmpegRoot -File | Copy-Item -Destination (Join-Path $outputRoot 'runtime') -Force
    } else { Write-Warning 'FFmpeg is absent: run scripts/fetch-ffmpeg.ps1 before producing the recording-enabled offline bundle.' }
    $manifest = Get-ChildItem -LiteralPath $outputRoot -Recurse -File | Where-Object Name -ne 'SHA256SUMS.txt' | ForEach-Object {
        $relative = $_.FullName.Substring($outputRoot.Length + 1)
        '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
    }
    $manifest | Set-Content -LiteralPath (Join-Path $outputRoot 'SHA256SUMS.txt') -Encoding UTF8
}
Write-Output $outputRoot
