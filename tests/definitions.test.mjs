import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstCollectionFields, lstOptionCountryState, lstReportConfig } from '../dist/definition.mjs';
import { renameObjectArrayProperties } from '../dist/tally/index.mjs';
import { registerMcpServer } from '../dist/mcp.mjs';

test('every country exposes its states under the same key', () => {
    for (const entry of lstOptionCountryState) {
        assert.ok(Array.isArray(entry.state), `${entry.country} has no 'state' array`);
        assert.ok(!('states' in entry), `${entry.country} still uses the old 'states' key`);
    }
    assert.equal(lstOptionCountryState.find((c) => c.country === 'USA').state.length, 50);
});

test('the GSTIN pattern accepts a real GSTIN and rejects a date', async () => {
    const server = await registerMcpServer();
    const shape = server._registeredTools['ledger-create-update'].inputSchema.shape;
    const gstin = shape.masters.element.shape.gstRegistrationDetails.unwrap().shape.gstin;

    assert.equal(gstin.safeParse('27AAPFU0939F1ZV').success, true);
    assert.equal(gstin.safeParse('2024-01-01').success, false, 'the old date pattern is back');
    assert.equal(gstin.safeParse('27AAPFU0939F1Z').success, false, '14 characters must be rejected');
});

test('renameObjectArrayProperties maps only the listed keys', () => {
    const out = renameObjectArrayProperties(
        [{ party_ledger: 'Acme', amount: -100 }],
        new Map([['party_ledger', 'party_name']]));

    assert.deepEqual(out, [{ party_name: 'Acme', amount: -100 }]);
});

test('renameObjectArrayProperties returns writable plain objects', () => {
    const [row] = renameObjectArrayProperties([{ a: 1 }], new Map([['a', 'b']]));
    row.b = 2; // Object.defineProperty used to make this silently fail
    assert.equal(row.b, 2);
});

test('report output names match the columns the tools cache', () => {
    // both reports emit party_ledger; the tools rename it to party_name
    for (const name of ['ledger-account', 'stock-item-account']) {
        const report = lstReportConfig.find((r) => r.name === name);
        assert.ok(report.output.some((f) => f.name === 'party_ledger'),
            `${name} no longer emits party_ledger, the rename in the tool is now wrong`);
    }
});

test('collection definitions are unique and non-empty', () => {
    const names = lstCollectionFields.map((c) => c.collection);
    assert.equal(new Set(names).size, names.length, 'duplicate collection name');
    for (const c of lstCollectionFields)
        assert.ok(c.fields.length > 0, `${c.collection} has no fields`);
});
