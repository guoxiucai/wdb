param([string]$DataDir = "$PSScriptRoot\..\.runtime\server")
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
if (!(Test-Path (Join-Path $DataDir 'tls.pfx'))) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $password = [Convert]::ToBase64String($bytes)
  $cert = New-SelfSignedCertificate -DnsName 'localhost','wdb.local' -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(5)
  Export-PfxCertificate -Cert $cert -FilePath (Join-Path $DataDir 'tls.pfx') -Password (ConvertTo-SecureString $password -AsPlainText -Force) | Out-Null
  [IO.File]::WriteAllText((Join-Path $DataDir 'tls-password'),$password)
  $sha = [Security.Cryptography.SHA256]::Create()
  $fp = [BitConverter]::ToString($sha.ComputeHash($cert.RawData)).Replace('-','')
  [IO.File]::WriteAllText((Join-Path $DataDir 'fingerprint'),$fp)
  Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($cert.Thumbprint)"
}
foreach ($name in @('helper-secret','pairing-code')) {
  $file=Join-Path $DataDir $name
  if (!(Test-Path $file)) {
    $bytes=New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [IO.File]::WriteAllText($file,[Convert]::ToBase64String($bytes))
  }
}
Write-Output "Initialized $DataDir"
