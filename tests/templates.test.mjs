import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import nunjucks from 'nunjucks';
import { tallyTemplates } from '../dist/templates.generated.mjs';

const root = new URL('..', import.meta.url).pathname;
const templateDir = join(root, 'templates');

const walk = (dir) => readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : [full];
});

const njkFiles = walk(templateDir).filter((f) => f.endsWith('.njk'));

test('every .njk template compiles', () => {
    const env = new nunjucks.Environment();
    for (const file of njkFiles) {
        const name = relative(templateDir, file);
        // the fourth argument forces an eager compile, so a syntax error throws here
        assert.doesNotThrow(
            () => new nunjucks.Template(readFileSync(file, 'utf8'), env, name, true),
            `${name} does not compile`);
    }
});

test('the generated map covers every .njk template', () => {
    const expected = njkFiles
        .map((f) => relative(templateDir, f).replace(/\.njk$/, '').split(sep).join('/'))
        .sort();
    assert.deepEqual([...tallyTemplates.keys()].sort(), expected,
        'run `pnpm build:templates` after adding or removing a template');
});

test('the generated templates are current', () => {
    const minify = (s) => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).join('').trim();
    for (const file of njkFiles) {
        const name = relative(templateDir, file).replace(/\.njk$/, '').split(sep).join('/');
        assert.equal(tallyTemplates.get(name), minify(readFileSync(file, 'utf8')),
            `${name} is stale, run \`pnpm build:templates\``);
    }
});

test('every template still produces well formed XML around its tags', () => {
    for (const [name, xml] of tallyTemplates) {
        assert.ok(xml.startsWith('<ENVELOPE>'), `${name} does not open with <ENVELOPE>`);
        assert.ok(xml.endsWith('</ENVELOPE>'), `${name} does not close with </ENVELOPE>`);
    }
});
