[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $PfxPath,
    [Parameter(Mandatory = $true)][string] $Password,
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$thumbprintPath = [IO.Path]::ChangeExtension($PfxPath, '.thumbprint')

if ($Remove) {
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
    $cert = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation 'Cert:\LocalMachine\My' -Password $securePassword
} else {
    $cert = New-SelfSignedCertificate `
        -Subject 'CN=localhost' `
        -DnsName 'localhost' `
        -CertStoreLocation 'Cert:\LocalMachine\My' `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears(10)

    Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $securePassword -Force | Out-Null
}

# Trust this exact self-signed localhost certificate for every user on the
# machine. This is what lets desktop clients accept the local HTTPS endpoint.
$cerPath = [IO.Path]::ChangeExtension($PfxPath, '.cer')
Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
Remove-Item -LiteralPath $cerPath -Force
Set-Content -LiteralPath $thumbprintPath -Value $cert.Thumbprint -NoNewline
