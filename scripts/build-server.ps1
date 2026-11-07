[CmdletBinding()]
param(
 [switch]$Sign,[switch]$Resume,[string]$BuildId,[string]$OutputRoot,[string]$OutputDirectory,
 [string]$Publisher='WDB',[string]$SignEndpoint='https://mhci-sign.gz.cvte.cn/',
 [string]$SignSource,[ValidateRange(1,3600)][int]$SignTimeoutSeconds=300
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if(!$OutputRoot){$OutputRoot=Join-Path $root 'dist\server-builds'}
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
if(!$BuildId){if($Resume){throw 'Resume requires BuildId'};$BuildId='server-'+$version.Replace('.','-')+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)}
if($BuildId -notmatch '^[A-Za-z0-9-]+$'){throw 'Invalid BuildId'}
$build=Join-Path $OutputRoot $BuildId;$stateFile=Join-Path $build 'build-state.json'
$mode=if($Sign){'Manual'}else{'Development'}
if(!$SignSource){$SignSource="WDB/$version/$BuildId"}
if(!$OutputDirectory){$OutputDirectory=Join-Path $build "output\$version"}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if((Test-Path -LiteralPath $build) -and !$Resume){throw 'BuildId already exists; use Resume or choose a new BuildId'}
if($Resume -and !(Test-Path -LiteralPath $stateFile)){throw 'Build state missing'}
function Read-State {return Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json}
function Run-Phase([string]$Phase){
 $arguments=@{Phase=$Phase;BuildId=$BuildId;OutputRoot=$OutputRoot}
 if($Phase -eq 'Prepare'){
  $arguments.SigningMode=$mode;$arguments.ServerOnly=$true;$arguments.License='MIT';$arguments.LicenseFile=Join-Path $root 'LICENSE'
  $arguments.Publisher=if($Sign){$Publisher}else{'WDB Development'}
  if($Sign){$arguments.TrustManualSignatures=$true}
 }
 $text=@(& (Join-Path $PSScriptRoot 'build-release.ps1') @arguments)
 if(!$?){throw "Release phase $Phase failed"}
 $raw=$text -join [Environment]::NewLine
 [IO.File]::WriteAllText((Join-Path $build ("phase-$Phase.json")),$raw,(New-Object Text.UTF8Encoding($false)))
 return $raw | ConvertFrom-Json
}
if(!$Resume){$null=Run-Phase 'Prepare'}
$state=Read-State
if($state.signingMode -ne $mode -or !$state.serverOnly){throw 'Resume signing mode differs from this build'}
if($state.version -ne $version){throw 'Source version differs; use a new BuildId'}
if($Sign){
 # Freeze the service adapter beside the already-frozen content comparator.
 $signer=Join-Path $build 'tools\seewo-sign.js'
 if(!(Test-Path -LiteralPath $signer)){
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'seewo-sign.js') -Destination $signer
  $state.toolHashes+=@{name='seewo-sign.js';sha256=(Get-FileHash -LiteralPath $signer -Algorithm SHA256).Hash}
  $state | Add-Member -NotePropertyName signingService -NotePropertyValue @{endpoint=$SignEndpoint;customer='SEEWO';source=$SignSource} -Force
  $state | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $stateFile -Encoding UTF8
 }
 if($state.signingService.endpoint -cne $SignEndpoint -or $state.signingService.source -cne $SignSource){throw 'Resume signing parameters differ'}
 $node=Join-Path $build 'common\runtime\node.exe'
 $lock=Get-Content -LiteralPath (Join-Path $build 'common\DEPENDENCIES.json') -Raw | ConvertFrom-Json
 if((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash -ine $lock.node.sha256){throw 'Frozen Node changed'}
 foreach($tool in $state.toolHashes){if((Get-FileHash -LiteralPath (Join-Path $build ('tools\'+$tool.name)) -Algorithm SHA256).Hash -ine $tool.sha256){throw 'Frozen signing tooling changed'}}
 function Sign-Manifest([string]$Manifest,[string]$Report){
  & $node $signer --root $build --manifest $Manifest --report (Join-Path $build $Report) --endpoint $SignEndpoint --source $SignSource --timeout ($SignTimeoutSeconds*1000)
  if($LASTEXITCODE -ne 0){throw 'SEEWO signing failed; build retained for inspection/Resume. No unsigned fallback.'}
 }
 if($state.phase -in @('prepared','awaiting-uninstaller-signature')){Sign-Manifest (Join-Path $build 'signing-plan.json') 'payload-signing.json'}
}
$state=Read-State
if($state.phase -in @('prepared','awaiting-uninstaller-signature')){
 for($attempt=0;$attempt -lt 4;$attempt++){
  $result=Run-Phase 'Package';$state=Read-State
  if($state.phase -eq 'packaged'){break}
  if(!$Sign -or $state.phase -ne 'awaiting-uninstaller-signature'){throw 'Unexpected packaging state'}
  $list=Join-Path $build 'uninstaller-files.json'
  ConvertTo-Json -InputObject @($result.files) | Set-Content -LiteralPath $list -Encoding UTF8
  Sign-Manifest $list 'uninstaller-signing.json'
 }
 if($state.phase -ne 'packaged'){throw 'Uninstaller signing did not complete; inspect compiler logs'}
}
$release=Join-Path $build "release\$mode"
if($state.phase -eq 'packaged'){
 if($Sign){
  $list=Join-Path $build 'installer-files.json'
  ConvertTo-Json -InputObject @(Get-ChildItem -LiteralPath $release -Filter '*-setup.exe' | ForEach-Object FullName) | Set-Content -LiteralPath $list -Encoding UTF8
  Sign-Manifest $list 'installer-signing.json'
 }
 $null=Run-Phase 'Finalize'
}
$verification=@(& (Join-Path $PSScriptRoot 'verify-release.ps1') -ReleaseDirectory $release)
if(!$?){throw 'Release verification failed'}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$manifest=Get-Content -LiteralPath (Join-Path $release 'release-manifest.json') -Raw | ConvertFrom-Json
$outputs=@(foreach($artifact in $manifest.artifacts){
 $name=$artifact.name;if($Sign){$name=$name.Replace('-Manual-setup.exe','-setup.exe')}
 $target=Join-Path $OutputDirectory $name
 if(Test-Path -LiteralPath $target){if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $artifact.sha256){throw 'Output exists with different content; choose a new directory'}}
 else{Copy-Item -LiteralPath (Join-Path $release $artifact.name) -Destination $target}
 if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $artifact.sha256){throw 'Output hash mismatch'}
 [ordered]@{name=$name;path=$target;bytes=$artifact.bytes;sha256=$artifact.sha256}
})
$lines=@($outputs | ForEach-Object {'{0}  {1}' -f $_.sha256,$_.name})
[IO.File]::WriteAllLines((Join-Path $OutputDirectory 'SHA256SUMS.txt'),$lines,(New-Object Text.UTF8Encoding($false)))
[ordered]@{buildId=$BuildId;version=$version;signed=[bool]$Sign;customer=$(if($Sign){'SEEWO'}else{$null});sourceCommit=$state.sourceCommit;outputDirectory=$OutputDirectory;artifacts=$outputs} | ConvertTo-Json -Depth 8
