[CmdletBinding()]
param([string]$OutputFile)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if(!$OutputFile){$OutputFile=Join-Path $root 'native\bin\CaptureHost.exe'}
$OutputFile=[IO.Path]::GetFullPath($OutputFile)
New-Item -ItemType Directory -Path (Split-Path $OutputFile -Parent) -Force | Out-Null
$sources=@('CaptureHost.cs','CaptureInterop.cs','CaptureDesktop.cs','CaptureMedia.cs','CaptureVideoProcessor.cs') | ForEach-Object {Join-Path $root "native\$_"}
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /platform:x64 /unsafe+ /optimize+ /r:System.Web.Extensions.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll "/out:$OutputFile" @sources
if($LASTEXITCODE -ne 0){throw 'CaptureHost compilation failed'}
Write-Output $OutputFile
