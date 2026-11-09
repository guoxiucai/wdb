# Compatible with Windows PowerShell 5.1; also works via irm ... | iex.
param(
    [Alias('Agent')]$WdbInstallAgent,
    [Alias('Scope')]$WdbInstallScope,
    [Alias('Project')]$WdbInstallProject,
    [Alias('Yes')][switch]$WdbInstallYes
)
# Invoke-Expression evaluates top-level parameter attributes as variable
# attributes in the caller's scope. Keep validation inside the child scope and
# namespace the outer parameters so Agent/Scope variables remain untouched.
$WdbBootstrapParameters = @{}
foreach ($WdbParameterName in @('Agent', 'Scope', 'Project', 'Yes')) {
    $WdbOuterName = 'WdbInstall' + $WdbParameterName
    if ($PSBoundParameters.ContainsKey($WdbOuterName)) {
        $WdbBootstrapParameters[$WdbParameterName] = $PSBoundParameters[$WdbOuterName]
    }
}
& {
    param(
        [ValidateSet('codex', 'claude', 'both')][string]$Agent,
        [ValidateSet('user', 'project')][string]$Scope,
        [string]$Project,
        [switch]$Yes
    )
    $ErrorActionPreference = 'Stop'
    $temporary = $null
    $previousTls = [Net.ServicePointManager]::SecurityProtocol
    try {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS (minimum 22) and npm from https://nodejs.org/ then rerun.' }
        & node -e 'process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)'
        if ($LASTEXITCODE -ne 0) { throw 'Node.js >=22 is required. Install Node 24 LTS and rerun.' }
        [Net.ServicePointManager]::SecurityProtocol = $previousTls -bor [Net.SecurityProtocolType]::Tls12
        $temporary = Join-Path ([IO.Path]::GetTempPath()) ('wdb-install-' + [guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($temporary) | Out-Null
        $entry = Join-Path $temporary 'install-skill.cjs'
        Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/guoxiucai/wdb/main/scripts/install-skill.js" -OutFile $entry -TimeoutSec 30
        $arguments = @($entry)
        if ($Agent) { $arguments += @('--agent', $Agent) }
        if ($Scope) { $arguments += @('--scope', $Scope) }
        if ($Project) { $arguments += @('--project', $Project) }
        if ($Yes) { $arguments += '--yes' }
        & node @arguments
        if ($LASTEXITCODE -ne 0) { throw "WDB installer failed (exit $LASTEXITCODE)." }
    } finally {
        [Net.ServicePointManager]::SecurityProtocol = $previousTls
        if ($temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    }
} @WdbBootstrapParameters
