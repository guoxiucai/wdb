$ErrorActionPreference='Stop'
function Get-WdbPayloadFiles([string]$Root) {
    $rootPath=[IO.Path]::GetFullPath($Root).TrimEnd('\')
    $files=@()
    foreach($item in Get-ChildItem -LiteralPath $rootPath -Recurse -Force) {
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Payload contains a reparse point: $($item.FullName)"}
        if(!$item.PSIsContainer -and $item.FullName -ine (Join-Path $rootPath 'PAYLOAD-SHA256SUMS.txt')){$files+= $item}
    }
    return $files
}
function Write-WdbPayloadManifest([string]$Root) {
    $rootPath=[IO.Path]::GetFullPath($Root).TrimEnd('\')
    $lines=@(Get-WdbPayloadFiles $rootPath | Sort-Object FullName | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(),$_.FullName.Substring($rootPath.Length+1).Replace('\','/') })
    [IO.File]::WriteAllLines((Join-Path $rootPath 'PAYLOAD-SHA256SUMS.txt'),$lines,(New-Object Text.UTF8Encoding($false)))
}
function Test-WdbPayload([string]$Root, [switch]$Installed) {
    $rootPath=[IO.Path]::GetFullPath($Root).TrimEnd('\');$prefix=$rootPath+'\';$listed=@{}
    foreach($line in Get-Content -LiteralPath (Join-Path $rootPath 'PAYLOAD-SHA256SUMS.txt')) {
        if(!$line.Trim()){continue}
        if($line -notmatch '^([a-f0-9]{64})  (.+)$'){throw 'Invalid payload manifest'}
        $hash=$matches[1];$relative=$matches[2];$file=[IO.Path]::GetFullPath((Join-Path $rootPath $relative))
        if(!$file.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or $listed.ContainsKey($file)){throw 'Unsafe or duplicate payload entry'}
        if(!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $hash){throw "Payload missing or changed: $relative"}
        $listed[$file]=$true
    }
    foreach($item in Get-WdbPayloadFiles $rootPath){if(!$listed.ContainsKey($item.FullName)){$relative=$item.FullName.Substring($rootPath.Length+1);if($Installed -and $relative -match '^(runtime-binding\.json|installation-health\.json|unins\d+\.(exe|dat|msg))$'){continue};throw "Unlisted payload file: $($item.FullName)"}}
    $info=Get-Content -LiteralPath (Join-Path $rootPath 'BUILD-INFO.json') -Raw | ConvertFrom-Json
    if($info.runtimeMode -notin @('with-node','external-node')){throw 'Payload runtime mode missing'}
    foreach($file in @('package.json','src/server.js','src/helper.js','src/task-events.js','src/runtime-guard.js','src/server-streams.js','src/pty-host.js','node_modules/ws/index.js','node_modules/ws/LICENSE','native/bin/PtyHost.exe','native/WdbServiceHost.exe','native/bin/DesktopBridge.exe','native/desktop.ps1','runtime/ffmpeg.exe','runtime/ffprobe.exe','runtime/FFMPEG-LICENSE','runtime/FFMPEG-PROVENANCE.json','scripts/installer-action.ps1','scripts/resolve-node.ps1')){if(!(Test-Path -LiteralPath (Join-Path $rootPath $file))){throw "Required payload file missing: $file"}}
    $hasNode=Test-Path -LiteralPath (Join-Path $rootPath 'runtime/node.exe')
    if(($info.runtimeMode -eq 'with-node') -ne $hasNode){throw 'Node contents do not match runtime mode'}
    if((Get-Content -LiteralPath (Join-Path $rootPath 'package.json') -Raw | ConvertFrom-Json).version -ne $info.version){throw 'Product version mismatch'}
    return $info
}
