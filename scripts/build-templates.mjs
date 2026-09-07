/**
 * Compiles templates/**\/*.njk into src/templates.generated.mts.
 *
 * The Tally XML templates are authored as readable .njk files. They used to be
 * kept a second time, hand minified, inside definition.mts. Nothing loaded the
 * .njk copies, so they rotted: templates/push/master-ledger.njk had lost an
 * {% endif %} and no longer compiled. Generating one from the other keeps a
 * single source of truth.
 *
 * Run with `pnpm build:templates`, or `pnpm build`, which runs it first.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const templateDir = join(root, 'templates');
const outFile = join(root, 'src', 'templates.generated.mts');

/** Tally rejects nothing here, but the minified form keeps the payload small. */
const minify = (source) => source
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .join('')
  .trim();

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

const files = walk(templateDir)
  .filter((f) => f.endsWith('.njk'))
  .sort();

if (files.length === 0)
  throw new Error(`No .njk templates found under ${templateDir}`);

const entries = files.map((file) => {
  // 'templates/report/ledger-account.njk' becomes the key 'report/ledger-account'
  const name = relative(templateDir, file).replace(/\.njk$/, '').split(sep).join('/');
  return [name, minify(readFileSync(file, 'utf8'))];
});

const body = entries
  .map(([name, xml]) => `    [${JSON.stringify(name)}, ${JSON.stringify(xml)}]`)
  .join(',\n');

writeFileSync(outFile, `/**
 * GENERATED FILE - do not edit.
 * Produced from templates/**\\/*.njk by scripts/build-templates.mjs.
 * Run \`pnpm build:templates\` after changing any template.
 */

export const tallyTemplates: ReadonlyMap<string, string> = new Map([
${body}
]);
`);

console.log(`templates: wrote ${entries.length} templates to ${relative(root, outFile)}`);
for (const [name, xml] of entries) console.log(`  ${name} (${xml.length} chars)`);
