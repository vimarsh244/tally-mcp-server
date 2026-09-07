/**
 * The Tally target is per call, not per process.
 *
 * A Windows Server runs one copy of Tally per signed in user, each on its own
 * XML port, so one server process has to reach several of them at once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { runWithTallyTarget, currentTallyTarget, defaultTallyTarget } from '../dist/tally-target.mjs';
import { postTallyXml } from '../dist/tally/client.mjs';
import { probeTally } from '../dist/http/admin.mjs';

/** A stand-in Tally that reports which port took the request. */
async function startNamed(companyName) {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf16le');
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            requests.push(body);
            const xml = `<DATA><ROW><NAME>${companyName}</NAME><ISACTIVECOMPANY>Yes</ISACTIVECOMPANY></ROW></DATA>`;
            res.writeHead(200, { 'Content-Type': 'text/xml;charset=utf-16' });
            res.end(Buffer.from(xml, 'utf16le'));
        });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        port: server.address().port,
        requests,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

test('with no store in place the target comes from the environment', () => {
    assert.deepEqual(currentTallyTarget(), defaultTallyTarget());
});

test('two calls in the same process reach two different Tally instances', async () => {
    const alice = await startNamed('Alice Traders');
    const bob = await startNamed('Bob Exports');

    try {
        const target = (port) => ({ host: '127.0.0.1', port, timeout: 5000 });

        const toAlice = await runWithTallyTarget(target(alice.port), () => postTallyXml('<PING/>'));
        const toBob = await runWithTallyTarget(target(bob.port), () => postTallyXml('<PING/>'));

        assert.match(toAlice, /Alice Traders/);
        assert.match(toBob, /Bob Exports/);
        assert.equal(alice.requests.length, 1);
        assert.equal(bob.requests.length, 1);
    } finally {
        await alice.close();
        await bob.close();
    }
});

test('overlapping calls do not borrow each other\'s target', async () => {
    const alice = await startNamed('Alice Traders');
    const bob = await startNamed('Bob Exports');

    try {
        const target = (port) => ({ host: '127.0.0.1', port, timeout: 5000 });

        const [first, second] = await Promise.all([
            runWithTallyTarget(target(alice.port), () => postTallyXml('<PING/>')),
            runWithTallyTarget(target(bob.port), () => postTallyXml('<PING/>')),
        ]);

        assert.match(first, /Alice Traders/);
        assert.match(second, /Bob Exports/);
    } finally {
        await alice.close();
        await bob.close();
    }
});

test('a probe reports the companies a Tally has open', async () => {
    const alice = await startNamed('Alice Traders');

    try {
        const result = await probeTally('127.0.0.1', alice.port, 5000);
        assert.equal(result.reachable, true);
        assert.deepEqual(result.companies, [{ name: 'Alice Traders', active: true }]);
    } finally {
        await alice.close();
    }
});

test('a probe of a dead port reports why, and does not throw', async () => {
    const dead = await startNamed('unused');
    const port = dead.port;
    await dead.close();

    const result = await probeTally('127.0.0.1', port, 1000);
    assert.equal(result.reachable, false);
    assert.deepEqual(result.companies, []);
    assert.match(result.error ?? '', /Unable to connect to Tally/);
});
