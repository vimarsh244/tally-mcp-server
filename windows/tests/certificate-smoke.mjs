import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';

// Explicit Windows packaging smoke test; requires an elevated, disposable runner.
const stage = path.resolve(process.argv[2] || 'windows/stage');
const helper = path.join(stage, 'service/install-local-certificate.ps1');
const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const shell = (args) => execFileSync(powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf8' });

test('staged certificate supports verified Node HTTPS, repair, and uninstall', async () => {
    // This also catches the original packaging regression before touching a store.
    assert.deepEqual(readFileSync(helper), readFileSync('windows/service/install-local-certificate.ps1'));
    const dir = mkdtempSync(path.join(tmpdir(), 'tally certificate test '));
    const pfx = path.join(dir, 'localhost.pfx');
    const password = 'test-only-pfx-password';
    const run = (...extra) => shell(['-File', helper, '-PfxPath', pfx, '-Password', password, ...extra]);
    let thumbprint;
    try {
        run();
        thumbprint = readFileSync(path.join(dir, 'localhost.thumbprint'), 'utf8').trim();
        assert.match(thumbprint, /^[A-F0-9]{40}$/);
        const der = shell(['-Command', `[Convert]::ToBase64String((Get-Item 'Cert:\\LocalMachine\\Root\\${thumbprint}').RawData)`]);
        const cert = new X509Certificate(Buffer.from(der.trim(), 'base64'));
        assert.equal(cert.checkHost('localhost'), 'localhost');
        assert.ok(cert.keyUsage.includes('1.3.6.1.5.5.7.3.1'));
        assert.equal(cert.ca, false);
        const server = https.createServer({ pfx: readFileSync(pfx), passphrase: password }, (_, res) => res.end('secure'));
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        try {
            await new Promise((resolve, reject) => {
                https.get({ host: '127.0.0.1', port: server.address().port, servername: 'localhost', ca: cert.toString() }, res => {
                    let body = '';
                    res.on('data', chunk => { body += chunk; });
                    res.on('end', () => {
                        try { assert.equal(body, 'secure'); resolve(); } catch (error) { reject(error); }
                    });
                    res.on('error', reject);
                }).on('error', reject);
            });
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
        const original = readFileSync(pfx);
        // An upgrade keeps the private key and repairs missing machine trust.
        shell(['-Command', `Remove-Item 'Cert:\\LocalMachine\\Root\\${thumbprint}' -Force`]);
        run();
        assert.deepEqual(readFileSync(pfx), original);
        assert.equal(readFileSync(path.join(dir, 'localhost.thumbprint'), 'utf8').trim(), thumbprint);
        shell(['-Command', `$ErrorActionPreference = 'Stop'; Get-Item 'Cert:\\LocalMachine\\Root\\${thumbprint}' | Out-Null`]);
        run('-Remove');
        for (const store of ['My', 'Root']) {
            assert.equal(shell(['-Command', `Test-Path 'Cert:\\LocalMachine\\${store}\\${thumbprint}'`]).trim(), 'False');
        }
        run('-Remove'); // idempotent uninstall
        run(); // retained PFX supports reinstall
        assert.equal(readFileSync(path.join(dir, 'localhost.thumbprint'), 'utf8').trim(), thumbprint);
        assert.throws(() => shell(['-File', helper, '-PfxPath', pfx, '-Password', 'wrong-password']));
        assert.match(readFileSync(path.join(dir, 'localhost.certificate.log'), 'utf8'), /importing the existing PFX/);
        assert.deepEqual(readFileSync(pfx), original);
    } finally {
        run('-Remove');
        // Limit filesystem cleanup to the unique directory this test created.
        rmSync(dir, { recursive: true, force: true });
    }
});
