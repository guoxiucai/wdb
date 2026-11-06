[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SoakReport,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
$samples=@();$deadline=(Get-Date).AddMinutes(40)
do {
 $all=@(Get-CimInstance Win32_Process)
 $ids=@($all | Where-Object Name -eq 'WdbServiceHost.exe' | ForEach-Object ProcessId)
 for($depth=0;$depth -lt 6;$depth++){$ids=@($ids)+@($all | Where-Object {$_.ParentProcessId -in $ids} | ForEach-Object ProcessId);$ids=@($ids | Select-Object -Unique)}
 # Win32_Process exposes kernel/user accounting for SYSTEM children to this
 # normal-user diagnostic, whereas Get-Process.CPU can be null for those PIDs.
 $processes=@($all | Where-Object {$_.ProcessId -in $ids} | ForEach-Object {[pscustomobject][ordered]@{pid=$_.ProcessId;name=$_.Name;session=$_.SessionId;handles=[int]$_.HandleCount;rssBytes=[int64]$_.WorkingSetSize;cpuSeconds=([double]$_.KernelModeTime+[double]$_.UserModeTime)/10000000}})
 $samples+=@{at=[DateTime]::UtcNow.ToString('o');processes=$processes;cpuSeconds=($processes | Measure-Object cpuSeconds -Sum).Sum;rssBytes=($processes | Measure-Object rssBytes -Sum).Sum;handles=($processes | Measure-Object handles -Sum).Sum}
 [ordered]@{source='Win32_Process KernelModeTime + UserModeTime';samples=$samples} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $OutputFile -Encoding UTF8
 $status=(Get-Content -LiteralPath $SoakReport -Raw | ConvertFrom-Json).status
 if($status -ne 'running'){break}
 if((Get-Date) -gt $deadline){throw 'Process sampler exceeded the soak deadline'}
 Start-Sleep -Seconds 45
}while($true)
Write-Output "Process sampler finished; soak status: $status"
