param([Parameter(Mandatory=$true)][string]$RequestFile, [switch]$Development)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
    $output = Join-Path $PSScriptRoot 'bin\DesktopBridge.exe'
    $source = Join-Path $PSScriptRoot 'DesktopBridge.cs'
    $manifest = Join-Path $PSScriptRoot 'DesktopBridge.manifest'
    if (!(Test-Path -LiteralPath $output) -and !$Development) { throw 'Precompiled desktop bridge is missing. Repair the WDB installation.' }
    $needsBuild = !(Test-Path -LiteralPath $output)
    if ($Development -and !$needsBuild) {
        $builtAt = (Get-Item -LiteralPath $output).LastWriteTimeUtc
        $needsBuild = @($source,$manifest | Where-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc -gt $builtAt }).Count -gt 0
    }
    if ($Development -and $needsBuild) {
        [void](New-Item -ItemType Directory -Path (Split-Path $output) -Force)
        $build = & (Join-Path $framework 'csc.exe') /nologo /target:exe /platform:x64 /win32manifest:"$PSScriptRoot\DesktopBridge.manifest" /out:$output /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:"$framework\WPF\UIAutomationClient.dll" /r:"$framework\WPF\UIAutomationTypes.dll" /r:"$framework\WPF\WindowsBase.dll" $source 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Desktop adapter build failed: $build" }
    }
    if ($Development) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'DesktopBridge.exe.config') -Destination ($output+'.config') -Force }
    & $output $RequestFile
    exit $LASTEXITCODE
} catch {
    @{ok=$false;error=@{code='DESKTOP_BRIDGE_ERROR';message=$_.Exception.Message}} | ConvertTo-Json -Compress -Depth 5
    exit 1
}
