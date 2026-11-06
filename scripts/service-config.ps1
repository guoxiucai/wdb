# Keep the complete command line as a CIM string. Windows PowerShell 5.1 strips
# embedded quotes when forwarding this value through sc.exe's native argv.
function Set-WdbServiceConfiguration {
    [CmdletBinding()]
    param(
        [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$Name = 'WdbService',
        [Parameter(Mandatory=$true)][string]$BinaryPath
    )
    $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
    if (!$service) { throw "Service $Name does not exist." }
    $result = Invoke-CimMethod -InputObject $service -MethodName Change -Arguments @{ PathName = $BinaryPath; StartMode = 'Automatic' } -ErrorAction Stop
    if ($result.ReturnValue -ne 0) { throw "Could not update ${Name}: Win32_Service.Change returned $($result.ReturnValue)." }
    $updated = Get-CimInstance -ClassName Win32_Service -Filter "Name='$Name'" -ErrorAction Stop
    if ($updated.PathName -cne $BinaryPath) { throw "Service $Name command line verification failed after update." }
}
