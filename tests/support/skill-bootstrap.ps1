param([string]$BootstrapPath,[string]$ProbeMode)
$ErrorActionPreference='Stop'
$Agent='caller-agent';$Scope='caller-scope';$Project='caller-project';$Yes='caller-yes'
$calls=New-Object 'System.Collections.Generic.List[object]'
$downloads=New-Object 'System.Collections.Generic.List[string]'
function node {
    $calls.Add(@($args))
    $global:LASTEXITCODE=0
    if($ProbeMode -eq 'failure' -and $calls.Count -eq 2){$global:LASTEXITCODE=9}
}
function Invoke-WebRequest {
    param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing)
    $downloads.Add($OutFile)
    [IO.File]::WriteAllText($OutFile,'// isolated test entry')
}
$tlsBefore=[Net.ServicePointManager]::SecurityProtocol
$text=[IO.File]::ReadAllText($BootstrapPath)
$caught=$false
try {
    if($ProbeMode -eq 'iex' -or $ProbeMode -eq 'failure'){Invoke-Expression $text}
    elseif($ProbeMode -eq 'file'){& $BootstrapPath -Agent both -Scope project -Project 'C:\wdb project' -Yes}
    elseif($ProbeMode -eq 'invalid'){& ([scriptblock]::Create($text)) -Scope invalid}
    else {& ([scriptblock]::Create($text)) -Agent both -Scope project -Project 'C:\wdb project' -Yes}
} catch {if($ProbeMode -notin @('invalid','failure')){throw};$caught=$true}
if($Agent -ne 'caller-agent' -or $Scope -ne 'caller-scope' -or $Project -ne 'caller-project' -or $Yes -ne 'caller-yes'){throw 'Caller variables changed'}
if([Net.ServicePointManager]::SecurityProtocol -ne $tlsBefore){throw 'TLS state changed'}
foreach($entry in $downloads){if(Test-Path -LiteralPath (Split-Path $entry)){throw 'Temporary directory leaked'}}
if(($ProbeMode -in @('invalid','failure')) -and !$caught){throw 'Expected failure'}
if($ProbeMode -eq 'invalid'){if($calls.Count){throw 'Invalid scope executed node'}}
else {
    if($calls.Count -ne 2){throw 'Expected Node version check and installer invocation'}
    $actual=@($calls[1]);$expected=if($ProbeMode -in @('iex','failure')){@()}else{@('--agent','both','--scope','project','--project','C:\wdb project','--yes')}
    if(($actual.Count -ne $expected.Count+1) -or (($actual | Select-Object -Skip 1) -join '|') -ne ($expected -join '|')){throw 'Incorrect forwarded arguments'}
}
[ordered]@{status='passed';mode=$ProbeMode;powershell=$PSVersionTable.PSVersion.ToString();callerPreserved=$true;tlsRestored=$true;temporaryCleaned=$true} | ConvertTo-Json -Compress
