import { describe, expect, it } from 'vitest';
import { parseFrame } from '../src/parse.js';
import { fixtures } from './fixtures.js';
import { bytes } from './helpers.js';

/** Expected decode per distinct bytes 3-6, checked against the display notes in captures/NOTES.md. */
const states: Record<string, { raw: number; unit: string; value?: number; stable: boolean; negative?: boolean }> = {
  '00 00 02 CA': { raw: 0, unit: 'g', value: 0, stable: true },
  '00 00 02 CE': { raw: 0, unit: 'g', value: 0, stable: false },
  '01 18 02 CA': { raw: 280, unit: 'g', value: 28, stable: true },
  '14 88 02 CA': { raw: 5256, unit: 'g', value: 525.6, stable: true },
  '14 89 02 CA': { raw: 5257, unit: 'g', value: 525.7, stable: true },
  '02 CE 02 CA': { raw: 718, unit: 'g', value: 71.8, stable: true },
  '00 F8 02 CA': { raw: 248, unit: 'g', value: 24.8, stable: true },
  '02 CE 03 CA': { raw: 718, unit: 'g', value: -71.8, stable: true, negative: true },
  '00 0C 22 CA': { raw: 12, unit: 'lb:oz', stable: true },
  '00 F3 34 CA': { raw: 243, unit: 'oz', value: 2.43, stable: true },
  '00 00 12 CA': { raw: 0, unit: 'ml', stable: true },
  '00 00 44 CA': { raw: 0, unit: 'fl.oz', stable: true },
};

describe('parseFrame', () => {
  const all = Object.entries(fixtures).flatMap(([label, frames]) => frames.map((hex) => ({ label, hex })));

  it.each(all)('decodes $label: $hex', ({ hex }) => {
    const result = parseFrame(bytes(hex));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const f = result.frame;
    expect(f.raw).toEqual(bytes(hex));
    const known = states[hex.split(' ').slice(3, 7).join(' ')];
    if (known) {
      expect(f.rawWeight).toBe(known.raw);
      expect(f.unit).toBe(known.unit);
      expect(f.value).toBe(known.value);
      expect(f.stable).toBe(known.stable);
      expect(f.negative).toBe(known.negative ?? false);
    }
  });

  it('every stable settled state from the notes is covered by a fixture', () => {
    const seen = new Set(all.map(({ hex }) => hex.split(' ').slice(3, 7).join(' ')));
    for (const key of Object.keys(states)) expect(seen.has(key)).toBe(true);
  });

  it('marks changing frames as unstable', () => {
    const r = parseFrame(bytes('AC 05 00 0D 88 02 CE 85'));
    expect(r.ok && r.frame.stable).toBe(false);
  });

  it('rejects bad length and header', () => {
    expect(parseFrame(bytes('AC 05 00 00'))).toEqual({ ok: false, rejection: { reason: 'bad-length', length: 4 } });
    expect(parseFrame(bytes('AB 05 00 00 00 02 CA D3'))).toEqual({ ok: false, rejection: { reason: 'bad-header', header: 0xab } });
  });
});
