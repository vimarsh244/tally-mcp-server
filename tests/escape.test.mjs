import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlIdentifier, tdlQuoted, tdlString } from '../dist/escape.mjs';

test('tdlString removes double quotes, which TDL cannot escape', () => {
    assert.equal(tdlString('Sun"dry'), 'Sundry');
    assert.equal(tdlString('a""b'), 'ab');
    assert.equal(tdlString('plain'), 'plain');
});

test('tdlString flattens newlines so an expression cannot be split', () => {
    assert.equal(tdlString('a\nb'), 'a b');
    assert.equal(tdlString('a\r\nb'), 'a b');
});

test('tdlQuoted always yields a balanced literal', () => {
    for (const input of ['Acme', 'Sun"dry', '"', '""', 'a"b"c']) {
        const quoted = tdlQuoted(input);
        assert.ok(quoted.startsWith('"') && quoted.endsWith('"'));
        // exactly the two delimiters, never an unbalanced third
        assert.equal(quoted.split('"').length - 1, 2, `unbalanced for ${JSON.stringify(input)}`);
    }
});

test('sqlIdentifier doubles quotes so a column name cannot break out', () => {
    assert.equal(sqlIdentifier('plain'), '"plain"');
    assert.equal(sqlIdentifier('we"ird'), '"we""ird"');
});
