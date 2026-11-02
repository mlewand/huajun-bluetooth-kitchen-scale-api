import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFrame } from '../src/parse.js';
import { toReading } from '../src/scale.js';
import { woziFixtures } from './fixtures.wozi.js';
import { bytes } from './helpers.js';

/** Expected decode per distinct bytes 3-6, checked against the display values in captures/wozi/NOTES.md. */
const states: Record<string, { raw: number; unit: string; value?: number; stable: boolean; negative?: boolean }> = {
  '00 00 00 CA': { raw: 0, unit: 'g', value: 0, stable: true },
  '00 00 00 CE': { raw: 0, unit: 'g', value: 0, stable: false },
  '01 B6 00 CA': { raw: 438, unit: 'g', value: 438, stable: true },
  '00 45 00 CA': { raw: 69, unit: 'g', value: 69, stable: true },
  '00 44 01 CA': { raw: 68, unit: 'g', value: -68, stable: true, negative: true }, // after tare, item removed
  '08 4B 00 CA': { raw: 2123, unit: 'g', value: 2123, stable: true },
  '00 00 32 CA': { raw: 0, unit: 'oz', value: 0, stable: true },
  '00 4B 32 CA': { raw: 75, unit: 'oz', value: 7.5, stable: true },
  '00 00 22 CA': { raw: 0, unit: 'lb:oz', stable: true },
  '00 4B 22 CA': { raw: 75, unit: 'lb:oz', stable: true }, // display 0 lb 7.5 oz
};

const times = { receivedAt: 0, receivedAtMonotonic: 0 };
const key = (hex: string) => hex.split(' ').slice(3, 7).join(' ');

describe('parseFrame (Wozi)', () => {
  const all = Object.entries(woziFixtures).flatMap(([label, frames]) => frames.map((hex) => ({ label, hex })));

  it.each(all)('decodes $label: $hex', ({ hex }) => {
    const result = parseFrame(bytes(hex));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const f = result.frame;
    expect(f.device).toBe('huajun');
    expect(f.raw).toEqual(bytes(hex));
    const known = states[key(hex)];
    if (known) {
      expect(f.rawWeight).toBe(known.raw);
      expect(f.unit).toBe(known.unit);
      expect(f.value).toBe(known.value);
      expect(f.stable).toBe(known.stable);
      expect(f.negative).toBe(known.negative ?? false);
    }
  });

  it('every state in the table is covered by a fixture', () => {
    const seen = new Set(all.map(({ hex }) => key(hex)));
    for (const k of Object.keys(states)) expect(seen.has(k)).toBe(true);
  });

  it('takes the decimals from byte 5, so one magnitude scales by what the frame says', () => {
    const value = (hex: string) => {
      const r = parseFrame(bytes(hex));
      return r.ok ? r.frame.value : undefined;
    };
    expect(value('AC 05 00 01 B6 00 CA 81')).toBe(438); // Wozi g, captured
    expect(value('AC 05 00 01 B6 02 CA 83')).toBe(43.8); // the same magnitude at HUAJUN's g decimals
    expect(value('AC 05 00 00 F3 34 CA 00')).toBe(2.43); // HUAJUN oz, captured
    expect(value('AC 05 00 00 4B 32 CA 47')).toBe(7.5); // Wozi oz, captured
  });

  it('decodes ml and fl.oz with the decimals of the display (inferred from the display, not captured)', () => {
    // The display showed 439 ml and 15.5 fl.oz when the fixed divisors gave 43.9 and 1.55.
    const ml = parseFrame(bytes('AC 05 00 01 B7 10 CA 92'));
    expect(ml.ok && ml.frame).toMatchObject({ unit: 'ml', value: 439 });
    const flOz = parseFrame(bytes('AC 05 00 00 9B 42 CA A7'));
    expect(flOz.ok && flOz.frame).toMatchObject({ unit: 'fl.oz', value: 15.5 });
  });

  it('keeps the whole grams and tenths of an oz through the HUAJUN rounding in toReading', () => {
    const reading = (hex: string) => {
      const r = parseFrame(bytes(hex));
      if (!r.ok) throw new Error(`rejected ${hex}`);
      return toReading(r.frame, times);
    };
    expect(reading('AC 05 00 08 4B 00 CA 1D')).toMatchObject({ value: 2123, grams: 2123, unit: 'g' });
    expect(reading('AC 05 00 00 44 01 CA 0F')).toMatchObject({ value: -68, grams: -68, unit: 'g' });
    expect(reading('AC 05 00 00 4B 32 CA 47')).toMatchObject({ value: 7.5, unit: 'oz' });
    expect('grams' in reading('AC 05 00 00 4B 32 CA 47')).toBe(false);
  });

  it.each(all)('byte 7 is the low byte of the sum of bytes 2-6: $hex', ({ hex }) => {
    const b = bytes(hex);
    expect(b.slice(2, 7).reduce((sum, x) => (sum + x) & 0xff, 0)).toBe(b[7]);
  });
});

describe('captures/wozi', () => {
  const dir = new URL('../captures/wozi/', import.meta.url);
  const known = new Set(Object.values(woziFixtures).flat());
  // try-nutrition sessions also hold the frames it wrote (`write: true`, FFB1), which aren't scale output.
  const frames = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) =>
      readFileSync(new URL(f, dir), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { char: string; hex: string; write?: boolean })
        .filter((line) => line.char === 'FFB2' && !line.write)
        .map(({ hex }) => ({ file: f, hex })),
    );
  const isControl = (hex: string) => hex.split(' ')[2] === 'FE';

  it('has capture files', () => expect(frames.length).toBeGreaterThan(0));

  it.each(frames.filter(({ hex }) => !isControl(hex)))('$file: $hex decodes and is a fixture', ({ hex }) => {
    expect(parseFrame(bytes(hex)).ok).toBe(true);
    expect(known.has(hex)).toBe(true);
  });

  it.each(frames.filter(({ hex }) => isControl(hex)))('$file: $hex is rejected as a control frame', ({ hex }) => {
    const r = parseFrame(bytes(hex));
    expect(!r.ok && r.rejection.reason).toBe('control-frame');
  });
});
