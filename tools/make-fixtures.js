// Regenerates the golden .jfs fixtures: `node tools/make-fixtures.js` (see test/helpers/fixture-builders.js).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIXTURES, buildFixture } from '../test/helpers/fixture-builders.js';

const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
for (const [name, o] of Object.entries(FIXTURES)) writeFileSync(dir + name, buildFixture(o));
console.log(`Wrote ${Object.keys(FIXTURES).length} fixtures to ${dir}`);
