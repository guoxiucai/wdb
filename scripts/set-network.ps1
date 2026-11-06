[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Lan','Localhost')][string]$Mode,
    [string]$LocalAddress,
    [string[]]$RemoteAddress = @('LocalSubnet'),
    [string]$DataDirectory = "$env:ProgramData\wdb"
)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Network configuration requires administrator PowerShell.' }
$installationPath = Join-Path $DataDirectory 'installation.json'
$installation = Get-Content -LiteralPath $installationPath -Raw | ConvertFrom-Json
$node = Join-Path $installation.installDirectory 'runtime\node.exe'
$service = Get-CimInstance Win32_Service -Filter "Name='WdbService'"
if (!$service -or !(Test-Path -LiteralPath $node)) { throw 'Install WdbService before configuring its network.' }
$ruleName = 'WdbService-LAN'
$listenAddress = '127.0.0.1'
if ($Mode -eq 'Lan') {
    $parsedAddress = $null
    if (![Net.IPAddress]::TryParse($LocalAddress, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or [Net.IPAddress]::IsLoopback($parsedAddress) -or $LocalAddress -eq '0.0.0.0') { throw 'Supply a currently assigned non-loopback IPv4 LocalAddress.' }
    $adapter = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LocalAddress -ErrorAction Stop)
    if ($adapter.Count -ne 1) { throw 'LocalAddress must identify exactly one local network interface.' }
    if (!$RemoteAddress -or $RemoteAddress -contains 'Any' -or $RemoteAddress -contains '*' -or $RemoteAddress -contains '0.0.0.0/0' -or $RemoteAddress -contains '::/0') { throw 'Use LocalSubnet or specific client IPs/subnets, not unrestricted remote addresses.' }
    $listenAddress = '0.0.0.0'
    # Narrow rule applies even when Windows labels the selected LAN as Public.
    # Do not change the network category or open the desktop helper/debug ports.
    Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -Name $ruleName -DisplayName 'WDB HTTPS from selected LAN' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalPort $installation.port -LocalAddress $LocalAddress -RemoteAddress $RemoteAddress -InterfaceAlias $adapter[0].InterfaceAlias -Program $node -EdgeTraversalPolicy Block | Out-Null
} else {
    Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}
$binary = $service.PathName -replace '\s+--host\s+("[^"]*"|\S+)', ''
$binary += ' --host ' + $listenAddress
. (Join-Path $PSScriptRoot 'service-config.ps1')
Set-WdbServiceConfiguration -BinaryPath $binary
$installation | Add-Member -MemberType NoteProperty -Name listenAddress -Value $listenAddress -Force
$installation | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $installationPath -Encoding UTF8
$network = [ordered]@{mode=$Mode; listenAddress=$listenAddress; localAddress=$LocalAddress; port=$installation.port; remoteAddress=$RemoteAddress; interfaceAlias=$(if ($adapter) {$adapter[0].InterfaceAlias} else {$null}); updatedAt=[DateTime]::UtcNow.ToString('o')}
$network | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataDirectory 'network.json') -Encoding UTF8
# Execute this management script locally, outside a WDB task: restarting the
# service ends its child process tree, including an in-service shell task.
if ($service.State -eq 'Running') { Restart-Service WdbService } else { Start-Service WdbService }
$network | ConvertTo-Json
