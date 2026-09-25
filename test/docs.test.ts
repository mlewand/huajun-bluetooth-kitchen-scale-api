import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Names exported by an entry point: `export { a, type B } from ...` lists and `export class|interface|... Name`. */
function exportedNames(source: string): string[] {
  const names = [...source.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) =>
    m[1]!.split(',').map((n) => n.trim().replace(/^type\s+/, '')).filter(Boolean),
  );
  for (const m of source.matchAll(/^export\s+(?:abstract\s+)?(?:class|interface|const|function|type)\s+(\w+)/gm)) names.push(m[1]!);
  return names;
}

describe('docs/API.md', () => {
  const docs = read('docs/API.md');
  for (const entry of ['src/index.ts', 'src/node/index.ts', 'src/capacitor/index.ts']) {
    const names = exportedNames(read(entry));
    it(`finds the exports of ${entry}`, () => expect(names.length).toBeGreaterThan(0));
    it.each(names)(`${entry}: documents %s`, (name) => {
      expect(docs, `${name} is exported from ${entry} but missing from docs/API.md`).toMatch(new RegExp(`\\b${name}\\b`));
    });
  }
});
