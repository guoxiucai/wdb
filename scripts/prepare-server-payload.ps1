[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory,[Parameter(Mandatory=$true)][string]$BuildId,[ValidateSet('Development','Manual')][string]$SigningMode='Development',[string]$NodeCache,[string]$LicenseFile)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path -LiteralPath $output){throw 'Prepare requires a new payload directory'}
$lock=Get-Content -LiteralPath (Join-Path $root 'packaging\windows\dependencies.json') -Raw | ConvertFrom-Json
if(!$NodeCache){$NodeCache=Join-Path $root ('.runtime\dependencies\node-v'+$lock.node.version+'-win-x64')}
foreach($check in @(@{file=(Join-Path $NodeCache 'node.exe');hash=$lock.node.sha256},@{file=(Join-Path $NodeCache 'NODE-LICENSE.txt');hash=$lock.node.licenseSha256})){
 if(!(Test-Path -LiteralPath $check.file) -or (Get-FileHash -LiteralPath $check.file -Algorithm SHA256).Hash -ine $check.hash){throw "Pinned Node cache missing or changed: $($check.file). Populate it from $($lock.node.source) and verify dependencies.json."}
}
. (Join-Path $PSScriptRoot 'resolve-node.ps1')
$null=Resolve-WdbNode -RuntimeMode external-node -NodePath (Join-Path $NodeCache 'node.exe') -BuildPayload
foreach($file in $lock.ffmpeg.files){$source=Join-Path $root ('.runtime\ffmpeg\'+$file.name);if(!(Test-Path -LiteralPath $source) -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ine $file.sha256){throw "FFmpeg cache differs from lock: $($file.name)"}}
foreach($folder in @('src','native\bin','runtime','scripts','docs')){New-Item -ItemType Directory -Path (Join-Path $output $folder) -Force | Out-Null}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe';$framework=Split-Path $compiler
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /r:System.ServiceProcess.dll "/out:$(Join-Path $output 'native\WdbServiceHost.exe')" (Join-Path $root 'native\ServiceHost.cs')
if($LASTEXITCODE -ne 0){throw 'ServiceHost compilation failed'}
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$(Join-Path $output 'native\bin\DesktopBridge.exe')" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll "/r:$framework\WPF\UIAutomationClient.dll" "/r:$framework\WPF\UIAutomationTypes.dll" "/r:$framework\WPF\WindowsBase.dll" (Join-Path $root 'native\DesktopBridge.cs')
if($LASTEXITCODE -ne 0){throw 'DesktopBridge compilation failed'}
& (Join-Path $PSScriptRoot 'build-pty.ps1') -OutputFile (Join-Path $output 'native\bin\PtyHost.exe') | Out-Null
& node.exe (Join-Path $PSScriptRoot 'copy-ws.js') $output | Out-Null
if($LASTEXITCODE -ne 0){throw 'Locked WebSocket production dependency staging failed'}
Get-ChildItem -LiteralPath (Join-Path $root 'src') -File -Filter '*.js' | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $output 'src')}
$scripts=@('installer-action.ps1','install-service.ps1','register-service.ps1','repair-service.ps1','uninstall-service.ps1','service-config.ps1','service.ps1','set-network.ps1','init-data.ps1','resolve-node.ps1','payload-common.ps1','installer-health.js')
foreach($file in $scripts){Copy-Item -LiteralPath (Join-Path $root "scripts\$file") -Destination (Join-Path $output 'scripts')}
Copy-Item -LiteralPath (Join-Path $root 'native\desktop.ps1') -Destination (Join-Path $output 'native')
Copy-Item -LiteralPath (Join-Path $root 'package.json') -Destination $output
Copy-Item -LiteralPath (Join-Path $root 'package-lock.json') -Destination $output
Get-ChildItem -LiteralPath (Join-Path $root 'docs') -File -Filter '*.md' | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $output 'docs')}
Copy-Item -LiteralPath (Join-Path $root 'packaging\windows\dependencies.json') -Destination (Join-Path $output 'DEPENDENCIES.json')
Copy-Item -LiteralPath (Join-Path $NodeCache 'node.exe'),(Join-Path $NodeCache 'NODE-LICENSE.txt') -Destination (Join-Path $output 'runtime')
foreach($file in $lock.ffmpeg.files){Copy-Item -LiteralPath (Join-Path $root ('.runtime\ffmpeg\'+$file.name)) -Destination (Join-Path $output 'runtime')}
if($LicenseFile){Copy-Item -LiteralPath $LicenseFile -Destination (Join-Path $output 'LICENSE')}
elseif($SigningMode -eq 'Development'){[IO.File]::WriteAllText((Join-Path $output 'LICENSE'),"UNLICENSED`nLocal development artifact; project license pending maintainer configuration.`n")}
else{throw 'Manual release preparation requires LicenseFile'}
# Final PowerShell encoding is fixed before signature generation.
Get-ChildItem -LiteralPath $output -Recurse -Filter '*.ps1' | ForEach-Object {$text=[IO.File]::ReadAllText($_.FullName);$text=$text -replace '\r?\n',"`r`n";[IO.File]::WriteAllText($_.FullName,$text,(New-Object Text.UTF8Encoding($true)))}
$version=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$metadata=[ordered]@{product='wdb';version=$version;protocolVersion=1;buildId=$BuildId;sourceCommit=(& git -C $root rev-parse HEAD).Trim();sourceDirty=[bool](& git -C $root status --porcelain);builtAt=[DateTime]::UtcNow.ToString('o');signingMode=$SigningMode;runtimeMode='common';nodeVersion=$lock.node.version;nodeRange='>=24.15.0 <25';architecture='x64';platform='win32';development=$SigningMode -eq 'Development'}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'BUILD-INFO.json') -Encoding UTF8
$metadata | ConvertTo-Json
