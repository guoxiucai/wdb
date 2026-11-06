function Write-WdbPackageMetadata {
    param([string]$SourceRoot, [string]$OutputRoot, [string]$Kind, [string]$Node)
    $commit = $null
    $dirty = $null
    if ((Test-Path -LiteralPath (Join-Path $SourceRoot '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
        $commit = (& git -C $SourceRoot rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Could not identify source commit.' }
        $dirty = [bool](& git -C $SourceRoot status --porcelain)
    }
    $version = (Get-Content -LiteralPath (Join-Path $SourceRoot 'package.json') -Raw | ConvertFrom-Json).version
    $nodeVersion = (& $Node --version).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not identify packaged runtime.' }
    [ordered]@{ product='wdb'; version=$version; protocolVersion=1; kind=$Kind; platform='win32'; architecture='x64'; nodeVersion=$nodeVersion; sourceCommit=$commit; sourceDirty=$dirty; builtAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputRoot 'BUILD-INFO.json') -Encoding UTF8
}
