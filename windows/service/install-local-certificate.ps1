[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $PfxPath,
    [Parameter(Mandatory = $true)][string] $Password,
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$thumbprintPath = [IO.Path]::ChangeExtension($PfxPath, '.thumbprint')

$logPath = [IO.Path]::ChangeExtension($PfxPath, '.certificate.log')
$step = 'initializing certificate setup'

trap {
    $message = "Certificate setup failed while ${step}: $($_.Exception.Message)"
    # Do not record the invocation: it contains the PFX password.
    try { Set-Content -LiteralPath $logPath -Value $message -Encoding UTF8 } catch { }
    [Console]::Error.WriteLine($message)
    exit 1
}

if ($Remove) {
    $step = 'removing the recorded certificate'
    if (Test-Path -LiteralPath $thumbprintPath) {
        $thumbprint = (Get-Content -LiteralPath $thumbprintPath -Raw).Trim()
        foreach ($store in @('Cert:\LocalMachine\My', 'Cert:\LocalMachine\Root')) {
            $installed = Join-Path $store $thumbprint
            if (Test-Path -LiteralPath $installed) { Remove-Item -LiteralPath $installed -Force }
        }
        Remove-Item -LiteralPath $thumbprintPath -Force
    }
    exit 0
}

# Keep the PFX across upgrades. The installer uses a stable PFX password;
# access to the private key is controlled by the ProgramData ACL.
$securePassword = ConvertTo-SecureString -String $Password -AsPlainText -Force
if (Test-Path -LiteralPath $PfxPath) {
    $step = 'importing the existing PFX (check its password and file permissions)'
    $cert = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation 'Cert:\LocalMachine\My' -Password $securePassword
} else {
    $step = 'creating the localhost server certificate (administrator rights required)'
    $cert = New-SelfSignedCertificate `
        -Type SSLServerAuthentication `
        -Subject 'CN=localhost' `
        -DnsName 'localhost' `
        -CertStoreLocation 'Cert:\LocalMachine\My' `
        -Provider 'Microsoft Software Key Storage Provider' `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears(10)

    $step = 'exporting the private key to the protected data folder'
    Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $securePassword `
        -ChainOption EndEntityCertOnly -CryptoAlgorithmOption AES256_SHA256 -Force | Out-Null
}

# Trust this exact self-signed localhost certificate for every user on the
# machine. This is what lets desktop clients accept the local HTTPS endpoint.
$cerPath = [IO.Path]::ChangeExtension($PfxPath, '.cer')
$step = 'trusting the public certificate in LocalMachine\Root'
Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
Remove-Item -LiteralPath $cerPath -Force
Set-Content -LiteralPath $thumbprintPath -Value $cert.Thumbprint -NoNewline

Set-Content -LiteralPath $logPath -Value 'Localhost HTTPS certificate prepared successfully.' -Encoding UTF8
