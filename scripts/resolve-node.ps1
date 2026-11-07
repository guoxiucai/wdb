# Dot-source this file. Never execute a candidate until its location and signature
# are trusted: the installer runs as SYSTEM/administrator.
function Assert-WdbProtectedPath {
    param([Parameter(Mandatory=$true)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -notmatch '^[A-Za-z]:\\' -or $full.StartsWith('\\')) { throw 'Node must use a local absolute path, not UNC.' }
    if ($full -match '(?i)\\(Users|Temp|nvm|fnm|Volta)\\') { throw 'User profiles, temporary directories and user version managers cannot host a SYSTEM runtime.' }
    $trusted = @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    $item = Get-Item -LiteralPath $full -Force
    $root = [IO.Path]::GetPathRoot($full)
    while ($item -and $item.FullName.TrimEnd('\') -ne $root.TrimEnd('\')) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse points are not accepted for Node binding: $($item.FullName)" }
        $acl = Get-Acl -LiteralPath $item.FullName
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -notin $trusted) { throw "Node path owner can change its security: $($item.FullName) ($owner). Use a system-level Node installation." }
        foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
            $write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
            if (($rule.FileSystemRights -band $write) -and $rule.IdentityReference.Value -notin $trusted) { throw "Node path is writable by a non-administrator: $($item.FullName)" }
        }
        if ($item.PSIsContainer) { $item = $item.Parent } else { $item = $item.Directory }
    }
    return $full
}
function Resolve-WdbNode {
    [CmdletBinding()]
    param([ValidateSet('with-node','external-node')][string]$RuntimeMode='with-node', [string]$InstallDirectory="$env:ProgramFiles\wdb", [string]$NodePath, [switch]$BuildPayload)
    if ($RuntimeMode -eq 'with-node') { $NodePath=Join-Path $InstallDirectory 'runtime\node.exe' }
    elseif (!$NodePath) { $NodePath=Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    if (![IO.Path]::IsPathRooted($NodePath) -or $NodePath.StartsWith('\\')) { throw 'Supply an absolute local Node path.' }
    $NodePath=[IO.Path]::GetFullPath($NodePath)
    if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node runtime not found: $NodePath. Install system-wide Node >=22.0.0 from https://nodejs.org/ or use the with-node installer." }
    if (!$BuildPayload) { $null=Assert-WdbProtectedPath -Path $NodePath }
    $signature=Get-AuthenticodeSignature -LiteralPath $NodePath
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=OpenJS Foundation(?:,|$)') { throw 'Node must carry a valid OpenJS Foundation signature.' }
    $probe = & $NodePath -p 'JSON.stringify({path:process.execPath,version:process.versions.node,arch:process.arch,platform:process.platform})'
    if ($LASTEXITCODE -ne 0) { throw 'The selected Node runtime could not start.' }
    $runtime=$probe | ConvertFrom-Json
    if ($runtime.path -ine $NodePath -or $runtime.platform -ne 'win32' -or $runtime.arch -ne 'x64') { throw 'Node must be the actual Windows x64 runtime, not a shim.' }
    $version=[version]$runtime.version
    if ($version -lt [version]'22.0.0') { throw "Unsupported Node $version. Required >=22.0.0." }
    [pscustomobject][ordered]@{runtimeMode=$RuntimeMode;path=$NodePath;version=$runtime.version;architecture=$runtime.arch;sha256=(Get-FileHash -LiteralPath $NodePath -Algorithm SHA256).Hash.ToLowerInvariant();verifiedAt=[DateTime]::UtcNow.ToString('o');requiredVersion='>=22.0.0'}
}
function Get-WdbRuntimeBinding {
    param([string]$InstallDirectory="$env:ProgramFiles\wdb")
    $binding=Join-Path $InstallDirectory 'runtime-binding.json'
    if (Test-Path -LiteralPath $binding) { $saved=Get-Content -LiteralPath $binding -Raw | ConvertFrom-Json; return Resolve-WdbNode -RuntimeMode $saved.runtimeMode -InstallDirectory $InstallDirectory -NodePath $saved.path }
    Resolve-WdbNode -InstallDirectory $InstallDirectory
}
