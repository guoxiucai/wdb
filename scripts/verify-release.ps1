[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ReleaseDirectory)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($ReleaseDirectory).TrimEnd('\')
$manifest=Get-Content -LiteralPath (Join-Path $root 'release-manifest.json') -Raw | ConvertFrom-Json
if(@($manifest.artifacts | Where-Object {$_.name -like '*with-node*-setup.exe'}).Count -ne 1 -or @($manifest.artifacts | Where-Object {$_.name -like '*external-node*-setup.exe'}).Count -ne 1){throw 'Both runtime variants must be present'}
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
