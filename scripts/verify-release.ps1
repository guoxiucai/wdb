[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ReleaseDirectory)
$ErrorActionPreference='Stop'
$builtInModules=Join-Path $PSHOME 'Modules'
$env:PSModulePath=(@($builtInModules)+@($env:PSModulePath -split ';' | Where-Object {$_ -and $_ -ine $builtInModules})) -join ';'
$root=[IO.Path]::GetFullPath($ReleaseDirectory).TrimEnd('\')
$manifest=Get-Content -LiteralPath (Join-Path $root 'release-manifest.json') -Raw | ConvertFrom-Json
$expected=@(foreach($node in @('with-node','external-node')){foreach($ffmpeg in @('with-ffmpeg','no-ffmpeg')){"wdb-server-$($manifest.version)-windows-x64-$node-$ffmpeg-$($manifest.signingMode)-setup.exe"}})
$actual=@($manifest.artifacts | Where-Object {$_.name -like '*-setup.exe'} | ForEach-Object name)
if($actual.Count -ne 4 -or @(Compare-Object ($expected | Sort-Object) ($actual | Sort-Object)).Count){throw 'Exactly four installer variants must be present'}
if(@($manifest.artifacts | Where-Object {$_.name -like '*.tgz'}).Count -ne $(if($manifest.serverOnly){0}else{1})){throw 'One shared npm tarball is required'}
foreach($artifact in $manifest.artifacts){
 $file=[IO.Path]::GetFullPath((Join-Path $root $artifact.name))
 if((Split-Path $file -Parent) -ine $root){throw 'Invalid release artifact path'}
 if((Get-Item -LiteralPath $file).Length -ne $artifact.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $artifact.sha256){throw "Release artifact changed: $($artifact.name)"}
 if($manifest.signingMode -eq 'Manual' -and $manifest.signatureValidation -ne 'user-managed-not-validated' -and $file.EndsWith('.exe') -and (Get-AuthenticodeSignature -LiteralPath $file).Status -ne 'Valid'){throw 'Final installer signature is invalid'}
}
if(!$manifest.serverOnly){
$npm=@($manifest.artifacts | Where-Object {$_.name -like '*.tgz'})[0]
& node.exe -e 'const r=require(process.argv[1]).inspect(process.argv[2]); console.log(JSON.stringify({files:r.files.size,bytes:r.bytes,unpackedBytes:r.unpackedBytes}));' (Join-Path $PSScriptRoot 'verify-cli-npm.js') (Join-Path $root $npm.name)
if($LASTEXITCODE -ne 0){throw 'npm payload verification failed'}
}
[ordered]@{status='verified';buildId=$manifest.buildId;version=$manifest.version;signingMode=$manifest.signingMode;releaseReady=$manifest.releaseReady;artifacts=$manifest.artifacts} | ConvertTo-Json -Depth 8
