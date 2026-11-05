[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\.runtime\ffmpeg'),
    [string]$SourceUri = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip',
    [string]$Sha256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$downloadRoot = Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime\downloads'
New-Item -ItemType Directory -Force -Path $outputRoot, $downloadRoot | Out-Null
$extension = [IO.Path]::GetExtension(([Uri]$SourceUri).AbsolutePath)
if ($extension -notin @('.zip','.7z')) { throw 'Only zip and 7z archives are accepted.' }
$archive = Join-Path $downloadRoot "ffmpeg-essentials$extension"
if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $Sha256) {
    $partial = "$archive.part"
    & curl.exe --fail --location --retry 2 --connect-timeout 20 --output $partial $SourceUri
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg download failed: curl $LASTEXITCODE" }
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $Sha256) { throw 'FFmpeg archive SHA256 does not match the pinned release.' }
    Move-Item -LiteralPath $partial -Destination $archive -Force
}
$extractRoot = Join-Path $downloadRoot 'ffmpeg-extracted'
if ($extension -eq '.zip') { Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force }
else {
    $sevenZip = Join-Path $env:ProgramFiles '7-Zip\7z.exe'
    if (!(Test-Path -LiteralPath $sevenZip)) { throw '7-Zip is needed to extract a .7z build; use the default .zip download instead.' }
    & $sevenZip x $archive "-o$extractRoot" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '7-Zip extraction failed.' }
}
$ffmpeg = Get-ChildItem -LiteralPath $extractRoot -Recurse -File -Filter ffmpeg.exe | Select-Object -First 1
if (!$ffmpeg) { throw 'Archive did not contain ffmpeg.exe.' }
$releaseRoot = Split-Path (Split-Path $ffmpeg.FullName -Parent) -Parent
foreach ($name in @('ffmpeg.exe','ffprobe.exe')) {
    Copy-Item -LiteralPath (Join-Path $releaseRoot "bin\$name") -Destination $outputRoot -Force
}
foreach ($name in @('LICENSE','README.txt')) {
    $item = Join-Path $releaseRoot $name
    if (Test-Path -LiteralPath $item) { Copy-Item -LiteralPath $item -Destination (Join-Path $outputRoot "FFMPEG-$name") -Force }
}
[ordered]@{ source = $SourceUri; archiveSha256 = $Sha256; version = '9.0.2-essentials_build'; license = 'GPL-3.0-or-later'; upstream = 'https://ffmpeg.org'; buildProvider = 'https://www.gyan.dev/ffmpeg/builds/'; sourceCode = 'https://github.com/FFmpeg/FFmpeg/tree/946fcce07b' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'FFMPEG-PROVENANCE.json') -Encoding UTF8
& (Join-Path $outputRoot 'ffmpeg.exe') -version | Select-Object -First 1
& (Join-Path $outputRoot 'ffprobe.exe') -version | Select-Object -First 1
Write-Output $outputRoot
