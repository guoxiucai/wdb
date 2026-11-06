[CmdletBinding()]
param([string]$OutputFile)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if(!$OutputFile){$OutputFile=Join-Path $root 'native\bin\PtyHost.exe'}
$OutputFile=[IO.Path]::GetFullPath($OutputFile)
New-Item -ItemType Directory -Path (Split-Path $OutputFile -Parent) -Force | Out-Null
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /platform:x64 /optimize+ /r:System.Web.Extensions.dll "/out:$OutputFile" (Join-Path $root 'native\PtyHost.cs')
if($LASTEXITCODE -ne 0){throw 'PtyHost compilation failed'}
Write-Output $OutputFile
