[CmdletBinding()]
param(
 [switch]$Resume,[string]$BuildId,[string]$OutputRoot,[string]$OutputDirectory
)
$ErrorActionPreference='Stop'
# npm launched from PowerShell 7 can pass a module path without Windows
# PowerShell's built-ins. Prefer this process's own modules, preserving extras.
$builtInModules=Join-Path $PSHOME 'Modules'
$env:PSModulePath=(@($builtInModules)+@($env:PSModulePath -split ';' | Where-Object {$_ -and $_ -ine $builtInModules})) -join ';'
$root=Split-Path $PSScriptRoot -Parent
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if(!$OutputRoot){$OutputRoot=Join-Path $root 'dist\server-builds'}
$OutputRoot=[IO.Path]::GetFullPath($OutputRoot)
if(!$BuildId){if($Resume){throw 'Resume requires BuildId'};$BuildId='server-'+$version.Replace('.','-')+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)}
if($BuildId -notmatch '^[A-Za-z0-9-]+$'){throw 'Invalid BuildId'}
$build=Join-Path $OutputRoot $BuildId;$stateFile=Join-Path $build 'build-state.json'
$mode='Development'
if(!$OutputDirectory){$OutputDirectory=Join-Path $build "output\$version"}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if((Test-Path -LiteralPath $build) -and !$Resume){throw 'BuildId already exists; use Resume or choose a new BuildId'}
if($Resume -and !(Test-Path -LiteralPath $stateFile)){throw 'Build state missing'}
function Read-State {return Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json}
function Run-Phase([string]$Phase){
 $arguments=@{Phase=$Phase;BuildId=$BuildId;OutputRoot=$OutputRoot}
 if($Phase -eq 'Prepare'){
  $arguments.SigningMode=$mode;$arguments.ServerOnly=$true;$arguments.License='MIT';$arguments.LicenseFile=Join-Path $root 'LICENSE'
  $arguments.Publisher='WDB Development'
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
if($state.phase -eq 'prepared'){
 $null=Run-Phase 'Package';$state=Read-State
 if($state.phase -ne 'packaged'){throw 'Unexpected packaging state'}
}
$release=Join-Path $build "release\$mode"
if($state.phase -eq 'packaged'){
 $null=Run-Phase 'Finalize'
}
$verification=@(& (Join-Path $PSScriptRoot 'verify-release.ps1') -ReleaseDirectory $release)
if(!$?){throw 'Release verification failed'}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$manifest=Get-Content -LiteralPath (Join-Path $release 'release-manifest.json') -Raw | ConvertFrom-Json
$outputs=@(foreach($artifact in $manifest.artifacts){
 $name=$artifact.name
 $target=Join-Path $OutputDirectory $name
 if(Test-Path -LiteralPath $target){if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $artifact.sha256){throw 'Output exists with different content; choose a new directory'}}
 else{Copy-Item -LiteralPath (Join-Path $release $artifact.name) -Destination $target}
 if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ine $artifact.sha256){throw 'Output hash mismatch'}
 [ordered]@{name=$name;path=$target;bytes=$artifact.bytes;sha256=$artifact.sha256}
})
$lines=@($outputs | ForEach-Object {'{0}  {1}' -f $_.sha256,$_.name})
[IO.File]::WriteAllLines((Join-Path $OutputDirectory 'SHA256SUMS.txt'),$lines,(New-Object Text.UTF8Encoding($false)))
[ordered]@{buildId=$BuildId;version=$version;signed=$false;sourceCommit=$state.sourceCommit;outputDirectory=$OutputDirectory;artifacts=$outputs} | ConvertTo-Json -Depth 8
