$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
foreach ($file in (Get-ChildItem (Join-Path $root 'scripts') -Filter '*.ps1')) {
    $tokens = $null; $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw "Invalid PowerShell syntax in $($file.Name): $parseErrors" }
}
. (Join-Path $root 'scripts\service-config.ps1')
$script:wdbTestPath = 'old-path'
$script:wdbTestResult = 0
$script:wdbTestMismatch = $false
$script:wdbTestCall = $null
function Get-CimInstance { param($ClassName,$Filter,$ErrorAction) return [pscustomobject]@{ Name='WdbService'; PathName=$script:wdbTestPath } }
function Invoke-CimMethod {
    param($InputObject,$MethodName,$Arguments,$ErrorAction)
    $script:wdbTestCall = @{InputObject=$InputObject;Method=$MethodName;Arguments=$Arguments}
    if ($script:wdbTestResult -eq 0 -and !$script:wdbTestMismatch) { $script:wdbTestPath=$Arguments.PathName }
    return [pscustomobject]@{ReturnValue=$script:wdbTestResult}
}
$expected = '"C:\Program Files\wdb\native\WdbServiceHost.exe" --node "C:\Program Files\wdb\runtime\node.exe" --script "C:\Program Files\wdb\src\server.js" --data-dir "C:\test data\wdb" --port 18766'
Set-WdbServiceConfiguration -BinaryPath $expected
if ($script:wdbTestCall.Method -cne 'Change' -or $script:wdbTestCall.Arguments.PathName -cne $expected -or $script:wdbTestCall.Arguments.StartMode -cne 'Automatic') { throw 'The structured service command line or startup mode was altered.' }
$script:wdbTestResult=2
$denied=$false
try { Set-WdbServiceConfiguration -BinaryPath $expected } catch { if ($_.Exception.Message -match 'returned 2') { $denied=$true } else { throw } }
if (!$denied) { throw 'Nonzero Windows service result must fail installation.' }
$script:wdbTestResult=0; $script:wdbTestMismatch=$true; $script:wdbTestPath='wrong-path'
$mismatch=$false
try { Set-WdbServiceConfiguration -BinaryPath $expected } catch { if ($_.Exception.Message -match 'verification failed') { $mismatch=$true } else { throw } }
if (!$mismatch) { throw 'Service readback mismatch must fail installation.' }
Write-Output 'PASS: script syntax, quoted command line, provider failure, readback verification'
