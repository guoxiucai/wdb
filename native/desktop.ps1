param([Parameter(Mandatory=$true)][string]$RequestFile, [switch]$Development)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
    $output = Join-Path $PSScriptRoot 'bin\DesktopBridge.exe'
    $source = Join-Path $PSScriptRoot 'DesktopBridge.cs'
    if (!(Test-Path -LiteralPath $output) -and !$Development) { throw 'Precompiled desktop bridge is missing. Repair the WDB installation.' }
    if ($Development -and (!(Test-Path -LiteralPath $output) -or ((Test-Path -LiteralPath $source) -and (Get-Item -LiteralPath $source).LastWriteTimeUtc -gt (Get-Item -LiteralPath $output).LastWriteTimeUtc))) {
        [void](New-Item -ItemType Directory -Path (Split-Path $output) -Force)
        $build = & (Join-Path $framework 'csc.exe') /nologo /target:exe /platform:x64 /out:$output /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:"$framework\WPF\UIAutomationClient.dll" /r:"$framework\WPF\UIAutomationTypes.dll" /r:"$framework\WPF\WindowsBase.dll" $source 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Desktop adapter build failed: $build" }
    }
    & $output $RequestFile
    exit $LASTEXITCODE
} catch {
    @{ok=$false;error=@{code='DESKTOP_BRIDGE_ERROR';message=$_.Exception.Message}} | ConvertTo-Json -Compress -Depth 5
    exit 1
}
