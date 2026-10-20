import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFrame } from '../src/parse.js';
import { alphaFixtures } from './fixtures.alpha.js';
import { bytes } from './helpers.js';

/** Expected decode per distinct bytes 2-6, checked against the display values in captures/alpha/NOTES.md. */
const states: Record<string, { raw: number; unit: string; value?: number; approx?: number; stable: boolean; negative?: boolean }> = {
  '01 00 00 00 00': { raw: 0, unit: 'g', value: 0, stable: true },
  '00 00 00 00 00': { raw: 0, unit: 'g', value: 0, stable: false },
  '01 00 00 65 FE': { raw: 26110, unit: 'g', value: 26.11, stable: true }, // display 26 g
  '01 00 01 06 58': { raw: 67160, unit: 'g', value: 67.16, stable: true }, // display 67 g
  '01 00 01 07 A2': { raw: 67490, unit: 'g', value: 67.49, stable: true }, // file name says 68 g, display possibly 67
  '01 00 02 02 60': { raw: 131680, unit: 'g', value: 131.68, stable: true }, // display 132 g
  '01 00 17 7C 80': { raw: 1539200, unit: 'g', value: 1539.2, stable: true }, // file name 1539g
  '00 00 00 FF 28': { raw: 65320, unit: 'g', value: 65.32, stable: false },
  '01 10 00 AC 26': { raw: 44070, unit: 'ml', value: 44.07, stable: true }, // display 44 ml
  '01 20 01 05 4A': { raw: 66890, unit: 'lb:oz', stable: true }, // display 0 lb 2.4 oz
  '01 30 00 C0 76': { raw: 49270, unit: 'oz', approx: 1.738, stable: true }, // display 1.7 oz
  '81 00 00 9F CE': { raw: 40910, unit: 'g', value: -40.91, stable: true, negative: true }, // after tare, item removed
};

const key = (hex: string) => hex.split(' ').slice(2, 7).join(' ');

/** Appends the checksum (low byte of the sum of bytes 2-18) to the first 19 bytes. */
const withChecksum = (head: string) => {
  const b = bytes(head);
  const sum = b.slice(2).reduce((a, c) => (a + c) & 0xff, 0);
  return Uint8Array.from([...b, sum]);
};
const tail = '00 00 00 00 00 00 00 00 00 00 00 A6';

describe('parseFrame (alpha)', () => {
  const all = Object.entries(alphaFixtures).flatMap(([label, frames]) => frames.map((hex) => ({ label, hex })));

  it.each(all)('decodes $label: $hex', ({ hex }) => {
    const result = parseFrame(bytes(hex));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const f = result.frame;
    const b = bytes(hex);
    expect(f.device).toBe('alpha');
    expect(f.raw).toEqual(b);
    expect(f.rawWeight).toBe((b[4]! << 16) | (b[5]! << 8) | b[6]!);
    expect(f.stable).toBe((b[2]! & 1) === 1);
    expect(f.negative).toBe((b[2]! & 0x80) !== 0);
    const known = states[key(hex)];
    if (known) {
      expect(f.rawWeight).toBe(known.raw);
      expect(f.unit).toBe(known.unit);
      if (known.approx !== undefined) expect(f.value).toBeCloseTo(known.approx, 3);
      else expect(f.value).toBe(known.value);
      expect(f.stable).toBe(known.stable);
      expect(f.negative).toBe(known.negative ?? false);
    }
  });

  it('every state in the table is covered by a fixture', () => {
    const seen = new Set(all.map(({ hex }) => key(hex)));
    for (const k of Object.keys(states)) expect(seen.has(k)).toBe(true);
  });

  it('converts oz and leaves lb:oz without a value', () => {
    const oz = parseFrame(bytes('AC 41 01 30 00 C0 76 00 00 00 00 00 00 00 00 00 00 00 A6 0D'));
    expect(oz.ok && oz.frame.value).toBeCloseTo(1.738, 3); // display 1.7 oz
    const lbOz = parseFrame(bytes('AC 41 01 20 01 05 4A 00 00 00 00 00 00 00 00 00 00 00 A6 17'));
    expect(lbOz.ok && 'value' in lbOz.frame).toBe(false);
  });

  it('never yields a negative zero', () => {
    const r = parseFrame(withChecksum(`AC 41 81 00 00 00 00 ${tail}`));
    expect(r.ok && Object.is(r.frame.value, 0)).toBe(true);
  });

  it('decodes a changing negative frame (inferred, not captured)', () => {
    const r = parseFrame(withChecksum(`AC 41 80 00 00 9F CE ${tail}`));
    expect(r.ok && r.frame).toMatchObject({ negative: true, stable: false, value: -40.91 });
  });

  it('leaves stable and value absent when unseen flag bits are set', () => {
    const r = parseFrame(withChecksum(`AC 41 03 00 00 65 FE ${tail}`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.frame.rawWeight).toBe(26110);
    expect('stable' in r.frame).toBe(false);
    expect('value' in r.frame).toBe(false);
  });

  it('leaves unit and value absent for unit codes never seen on this scale', () => {
    const r = parseFrame(withChecksum(`AC 41 01 40 00 65 FE ${tail}`)); // 4 is fl.oz on HUAJUN
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.frame.rawWeight).toBe(26110);
    expect('unit' in r.frame).toBe(false);
    expect('value' in r.frame).toBe(false);
  });

  it('rejects frames other than weights by their type in byte 18', () => {
    // Device info (A0) from an HCI snoop log of the vendor app; it has a valid checksum and as a
    // weight would read as a stable 3081 g. The scale sends it only after the vendor app's D0 command.
    const deviceInfo = bytes('AC 41 01 00 2F 03 36 36 03 36 36 00 00 27 00 02 00 00 A0 D7');
    expect(parseFrame(deviceInfo)).toEqual({ ok: false, rejection: { reason: 'not-weight-frame', type: 0xa0 } });
    expect(parseFrame(deviceInfo, 'alpha')).toEqual({ ok: false, rejection: { reason: 'not-weight-frame', type: 0xa0 } });
  });

  it('rejects a wrong checksum, frame type, header and length', () => {
    const good = bytes('AC 41 01 00 00 65 FE 00 00 00 00 00 00 00 00 00 00 00 A6 0A');
    expect(parseFrame(good).ok).toBe(true);

    const badSum = Uint8Array.from(good);
    badSum[19] = 0x0b;
    expect(parseFrame(badSum)).toEqual({ ok: false, rejection: { reason: 'bad-checksum', expected: 0x0a, actual: 0x0b } });

    const badType = Uint8Array.from(good);
    badType[1] = 0x42;
    expect(parseFrame(badType)).toEqual({ ok: false, rejection: { reason: 'unknown-frame-type', type: 0x42 } });

    const badHeader = Uint8Array.from(good);
    badHeader[0] = 0xab;
    expect(parseFrame(badHeader)).toEqual({ ok: false, rejection: { reason: 'bad-header', header: 0xab } });

    expect(parseFrame(good.slice(0, 19))).toEqual({ ok: false, rejection: { reason: 'bad-length', length: 19 } });
  });
});

describe('parseFrame device selection', () => {
  const huajun = bytes('AC 05 00 01 18 02 CA 1A');
  const alpha = bytes('AC 41 01 00 00 65 FE 00 00 00 00 00 00 00 00 00 00 00 A6 0A');

  it('auto picks the decoder by frame length', () => {
    const h = parseFrame(huajun);
    const a = parseFrame(alpha, 'auto');
    expect(h.ok && h.frame.device).toBe('huajun');
    expect(a.ok && a.frame.device).toBe('alpha');
    expect(parseFrame(bytes('AC 05 00 00 00'))).toEqual({ ok: false, rejection: { reason: 'bad-length', length: 5 } });
  });

  it('an explicit device decodes its own frames', () => {
    expect(parseFrame(huajun, 'huajun').ok).toBe(true);
    expect(parseFrame(alpha, 'alpha').ok).toBe(true);
  });

  it('an explicit device rejects the other scale\'s frames as bad-length', () => {
    expect(parseFrame(alpha, 'huajun')).toEqual({ ok: false, rejection: { reason: 'bad-length', length: 20 } });
    expect(parseFrame(huajun, 'alpha')).toEqual({ ok: false, rejection: { reason: 'bad-length', length: 8 } });
  });
});

describe('captures/alpha', () => {
  const dir = new URL('../captures/alpha/', import.meta.url);
  const known = new Set(Object.values(alphaFixtures).flat());
  const frames = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) =>
      readFileSync(new URL(f, dir), 'utf8')
        .trim()
        .split('\n')
        .map((line) => ({ file: f, hex: (JSON.parse(line) as { hex: string }).hex })),
    );

  it('has capture files', () => expect(frames.length).toBeGreaterThan(0));

  it.each(frames)('$file: $hex decodes and is a fixture', ({ hex }) => {
    expect(parseFrame(bytes(hex)).ok).toBe(true);
    expect(known.has(hex)).toBe(true);
  });
});
