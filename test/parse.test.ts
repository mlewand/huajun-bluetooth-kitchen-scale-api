import { describe, expect, it } from 'vitest';
import { parseButton, parseFrame } from '../src/parse.js';
import { fixtures } from './fixtures.js';
import { bytes } from './helpers.js';

/** Expected decode per distinct bytes 3-6, checked against the display notes in captures/huajun/NOTES.md. */
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
  '00 00 12 CA': { raw: 0, unit: 'ml', value: 0, stable: true },
  '00 00 44 CA': { raw: 0, unit: 'fl.oz', value: 0, stable: true },
  '02 B1 12 CA': { raw: 689, unit: 'ml', value: 68.9, stable: true },
  '00 E8 44 CA': { raw: 232, unit: 'fl.oz', value: 2.32, stable: true },
  'BA 54 02 CA': { raw: 47700, unit: 'g', value: 4770, stable: true },
  // Seen once while switching oz -> ml: ml unit code, but byte 5 bits 1-3 = 2 instead of the usual 1.
  '00 00 14 CA': { raw: 0, unit: 'ml', value: 0, stable: true },
};

describe('parseFrame', () => {
  const all = Object.entries(fixtures).flatMap(([label, frames]) => frames.map((hex) => ({ label, hex })));
  const isControl = (hex: string) => hex.split(' ')[2] === 'FE';
  const weights = all.filter(({ hex }) => !isControl(hex));
  const controls = all.filter(({ hex }) => isControl(hex));

  it.each(weights)('decodes $label: $hex', ({ hex }) => {
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
    const seen = new Set(weights.map(({ hex }) => hex.split(' ').slice(3, 7).join(' ')));
    for (const key of Object.keys(states)) expect(seen.has(key)).toBe(true);
  });

  it('marks changing frames as unstable', () => {
    const r = parseFrame(bytes('AC 05 00 0D 88 02 CE 85'));
    expect(r.ok && r.frame.stable).toBe(false);
  });

  it('rejects bad length, header and frame type', () => {
    expect(parseFrame(bytes('AC 05 00 00'))).toEqual({ ok: false, rejection: { reason: 'bad-length', length: 4 } });
    expect(parseFrame(bytes('AB 05 00 00 00 02 CA D3'))).toEqual({ ok: false, rejection: { reason: 'bad-header', header: 0xab } });
    expect(parseFrame(bytes('AC 06 00 00 00 02 CA D3'))).toEqual({ ok: false, rejection: { reason: 'unknown-frame-type', type: 0x06 } });
  });

  it('captured both button events (+Plate and Total)', () => {
    expect(new Set(controls.map(({ hex }) => hex.split(' ').slice(2, 7).join(' ')))).toEqual(new Set(['FE 1E 03 00 00', 'FE 1E 04 00 00']));
  });

  it.each(controls)('rejects control frame $label: $hex', ({ hex }) => {
    expect(parseFrame(bytes(hex))).toEqual({ ok: false, rejection: { reason: 'control-frame', type: 0x1e } });
  });

  it.each(controls)('decodes the button in $label: $hex', ({ hex }) => {
    expect(parseButton(bytes(hex))).toBe(hex.split(' ')[4] === '03' ? 'plate' : 'total');
    expect(parseButton(bytes(hex), 'huajun')).toBe(parseButton(bytes(hex)));
    expect(parseButton(bytes(hex), 'alpha')).toBeUndefined();
  });

  it('finds no button in other frames', () => {
    expect(weights.every(({ hex }) => parseButton(bytes(hex)) === undefined)).toBe(true);
    for (const hex of [
      'AC 05 FE 1E 05 00 00 00', // code never captured
      'AC 05 FE 1E 03 01 00 00', // bytes 5-6 always 00 in captures
      'AC 05 FE 1D 00 14 00 00', // another control frame type
      'AC 06 FE 1E 03 00 00 00', // wrong frame type
      'AC 05 FE 1E 03 00 00', // wrong length
    ]) expect(parseButton(bytes(hex)), hex).toBeUndefined();
  });
});
