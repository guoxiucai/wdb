# Build-time only: expand the repository archive, never download or execute it.
function Expand-WdbVendoredFFmpeg {
    param([Parameter(Mandatory=$true)][string]$SourceRoot)
    $lock=Get-Content -LiteralPath (Join-Path $SourceRoot 'packaging\windows\dependencies.json') -Raw | ConvertFrom-Json
    $folder=Join-Path $SourceRoot 'vendor\ffmpeg'
    $archive=Join-Path $folder 'ffmpeg.zip'
    if(!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $lock.ffmpeg.vendoredArchiveSha256){throw 'Vendored FFmpeg archive missing or changed; restore vendor/ffmpeg/ffmpeg.zip from the project.'}
    $exe=Join-Path $folder 'ffmpeg.exe'
    $expected=($lock.ffmpeg.files | Where-Object name -eq 'ffmpeg.exe').sha256
    if((Test-Path -LiteralPath $exe) -and (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ieq $expected){return}
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    $partial=$exe+'.part'
    try {
        if($zip.Entries.Count -ne 1 -or $zip.Entries[0].FullName -ne 'ffmpeg.exe'){throw 'Unexpected vendored FFmpeg archive contents'}
        [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.Entries[0],$partial,$true)
        if((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $expected){throw 'Expanded FFmpeg hash mismatch'}
        Move-Item -LiteralPath $partial -Destination $exe -Force
    } finally {$zip.Dispose();if(Test-Path -LiteralPath $partial){Remove-Item -LiteralPath $partial -Force}}
}
