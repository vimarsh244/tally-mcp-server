import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResultCache } from '../dist/database.mjs';

test('a null number stays null and is not turned into zero', async () => {
    const cache = await ResultCache.create();
    const id = await cache.cacheTable(new Map([['name', 'string'], ['amount', 'amount']]),
        [{ name: 'a', amount: null }, { name: 'b', amount: 0 }, { name: 'c', amount: 12.5 }]);

    const rows = JSON.parse(await cache.executeSQL(`SELECT name, amount FROM ${id} ORDER BY name`));
    assert.deepEqual(rows, [
        { name: 'a', amount: null },
        { name: 'b', amount: 0 },
        { name: 'c', amount: 12.5 },
    ]);
    cache.close();
});

test('an empty result set yields an empty table id', async () => {
    const cache = await ResultCache.create();
    assert.equal(await cache.cacheTable(new Map([['a', 'string']]), []), '');
    cache.close();
});

test('only SELECT is permitted', async () => {
    const cache = await ResultCache.create();
    const id = await cache.cacheTable(new Map([['a', 'string']]), [{ a: 'x' }]);

    for (const sql of [
        `DROP TABLE ${id}`,
        `INSERT INTO ${id} VALUES ('y')`,
        `UPDATE ${id} SET a = 'y'`,
        `DELETE FROM ${id}`,
        `WITH t AS (DELETE FROM ${id} RETURNING *) SELECT * FROM t`,
        `/* comment */ DROP TABLE ${id}`,
        `-- hide\nDROP TABLE ${id}`,
    ]) {
        await assert.rejects(() => cache.executeSQL(sql), /Only SELECT queries are permitted/,
            `should have refused: ${sql}`);
    }

    // the table survived every attempt
    assert.deepEqual(JSON.parse(await cache.executeSQL(`SELECT a FROM ${id}`)), [{ a: 'x' }]);
    cache.close();
});

test('each cache is isolated from every other cache', async () => {
    const one = await ResultCache.create();
    const two = await ResultCache.create();

    const id = await one.cacheTable(new Map([['a', 'string']]), [{ a: 'secret' }]);
    await assert.rejects(() => two.executeSQL(`SELECT a FROM ${id}`),
        'a second session must not see the first session\'s table');

    one.close();
    two.close();
});

test('output formats', async () => {
    const cache = await ResultCache.create();
    const id = await cache.cacheTable(new Map([['name', 'string'], ['qty', 'number']]),
        [{ name: 'a,b', qty: 1 }, { name: 'c"d', qty: 2 }]);

    const csv = await cache.executeSQL(`SELECT name, qty FROM ${id} ORDER BY qty`, 'CSV');
    assert.equal(csv, 'name,qty\n"a,b",1\n"c""d",2');

    const md = await cache.executeSQL(`SELECT name, qty FROM ${id} ORDER BY qty`, 'Markdown Table');
    assert.equal(md.split('\n')[0], '| name | qty |');

    const schema = JSON.parse(await cache.executeSQL(`SELECT name, qty FROM ${id} ORDER BY qty`, 'JSON with Schema and Rows'));
    assert.deepEqual(schema.schema, ['name', 'qty']);
    assert.deepEqual(schema.rows, [['a,b', 1], ['c"d', 2]]);

    cache.close();
});
