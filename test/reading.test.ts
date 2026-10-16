import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFrame, Scale, toReading, type ParsedFrame } from '../src/index.js';
import { bytes, FakeTransport } from './helpers.js';

const parsed = (hex: string): ParsedFrame => {
  const result = parseFrame(bytes(hex));
  if (!result.ok) throw new Error('fixture must parse');
  return result.frame;
};

const times = { receivedAt: 1_790_000_000_000, receivedAtMonotonic: 5_000.25 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toReading', () => {
  it('maps a gram frame to a reading, with both receive times', () => {
    const frame = parsed('AC 05 00 01 18 02 CA 1A');
    expect(toReading(frame, times)).toEqual({
      device: 'huajun',
      grams: 28,
      value: 28,
      unit: 'g',
      stable: true,
      raw: frame.raw,
      ...times,
    });
  });

  it('keeps grams signed after tare', () => {
    expect(toReading(parsed('AC 05 00 02 CE 03 CA 1A'), times).grams).toBe(-71.8);
  });

  it('omits grams for other units, and fields the frame does not decode', () => {
    const oz = toReading(parsed('AC 05 00 00 F3 34 CA 1A'), times);
    expect(oz).toMatchObject({ unit: 'oz', value: 2.43 });
    expect('grams' in oz).toBe(false);

    // lb:oz: the unit is known, but how pounds and ounces are packed isn't confirmed, so there is no value.
    const lbOz = toReading(parsed('AC 05 00 00 0C 22 CA 1A'), times);
    expect(lbOz.unit).toBe('lb:oz');
    expect('value' in lbOz).toBe(false);
    expect('grams' in lbOz).toBe(false);

    // Byte 6 neither 0xCA nor 0xCE: stability unknown, so absent.
    expect('stable' in toReading(parsed('AC 05 00 01 18 02 00 1A'), times)).toBe(false);
  });

  it('gives the same reading Scale delivers for the same bytes and times', async () => {
    const transport = new FakeTransport([], false);
    const scale = new Scale(transport, { monotonicNow: () => times.receivedAtMonotonic });
    vi.spyOn(Date, 'now').mockReturnValue(times.receivedAt);
    const got: unknown[] = [];
    scale.onReading((r) => got.push(r));
    await scale.connect();
    const raw = bytes('AC 05 00 01 18 02 CE 1A');
    transport.emit(raw);
    expect(got).toEqual([toReading(parsed('AC 05 00 01 18 02 CE 1A'), times)]);
  });
});

describe('toReading for the alpha scale', () => {
  it('maps a gram frame, with the display unit and the device', () => {
    const frame = parsed('AC 41 01 00 00 65 FE 00 00 00 00 00 00 00 00 00 00 00 A6 0A');
    expect(toReading(frame, times)).toEqual({
      device: 'alpha',
      grams: 26,
      value: 26,
      unit: 'g',
      stable: true,
      raw: frame.raw,
      ...times,
    });
  });

  it('keeps grams signed after tare', () => {
    const reading = toReading(parsed('AC 41 81 00 00 9F CE 00 00 00 00 00 00 00 00 00 00 00 A6 94'), times);
    expect(reading).toMatchObject({ grams: -41, value: -41, stable: true });
  });

  it('reports oz as shown on the display and omits grams', () => {
    const reading = toReading(parsed('AC 41 01 30 00 C0 76 00 00 00 00 00 00 00 00 00 00 00 A6 0D'), times);
    expect(reading.unit).toBe('oz');
    expect(reading.value).toBe(1.7); // 1.738 oz at full precision
    expect('grams' in reading).toBe(false);
  });
});

describe('Reading resolution', () => {
  // Settled weights from captures/alpha, in milligrams.
  const mg = (n: number) => {
    const b = new Uint8Array(20);
    b.set([0xac, 0x41, 0x01, 0x00, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
    b[18] = 0xa6;
    let sum = 0;
    for (let i = 2; i < 19; i++) sum += b[i]!;
    b[19] = sum & 0xff;
    return b;
  };
  const read = (n: number, resolution?: Record<string, number>) => {
    const r = parseFrame(mg(n));
    if (!r.ok) throw new Error('must parse');
    return toReading(r.frame, times, resolution);
  };

  it('rounds alpha grams to the 1 g display by default', () => {
    expect([26110, 24670, 42100, 67490, 67160, 131680, 1539200].map((n) => read(n).value)).toEqual([26, 25, 42, 67, 67, 132, 1539]);
    expect(read(24670).grams).toBe(25);
  });

  it('rounds ml to 1 and oz to 0.1', () => {
    // Same weights as the ml and oz captures, built from a gram frame by setting the unit nibble.
    const frame = (unit: number, n: number) => { const b = mg(n); b[3] = unit << 4; b[19] = (b[19]! + (unit << 4)) & 0xff; return b; };
    const get = (b: Uint8Array) => { const r = parseFrame(b); if (!r.ok) throw new Error('must parse'); return toReading(r.frame, times); };
    expect(get(frame(1, 44070)).value).toBe(44);
    expect(get(frame(3, 49270)).value).toBe(1.7);
  });

  it('rounds negative weights symmetrically and never returns -0', () => {
    const neg = mg(40910); neg[2] = 0x81; neg[19] = (neg[19]! + 0x80) & 0xff;
    const r = parseFrame(neg);
    if (!r.ok) throw new Error('must parse');
    expect(toReading(r.frame, times).value).toBe(-41);
    expect(Object.is(read(300).value, 0)).toBe(true);
  });

  it('lets the caller ask for more precision', () => {
    expect(read(67490, { g: 0.1 }).value).toBe(67.5);
    expect(read(67490, { g: 0.001 }).value).toBe(67.49);
    expect(read(131680, { g: 0.5 }).value).toBe(131.5);
  });

  it('leaves HUAJUN at its 0.1 g / 0.1 ml / 0.01 oz / 0.01 fl.oz display', () => {
    expect(toReading(parsed('AC 05 00 02 CE 03 CA 1A'), times).value).toBe(-71.8);
    expect(toReading(parsed('AC 05 00 00 F3 34 CA 1A'), times).value).toBe(2.43);
    // captures/huajun/rev1: the displays showed 68.9 ml and 2.32 fl.oz.
    expect(toReading(parsed('AC 05 00 02 B1 12 CA C3'), times).value).toBe(68.9);
    expect(toReading(parsed('AC 05 00 00 E8 44 CA 5A'), times).value).toBe(2.32);
  });

  it('rejects resolutions that are not finite and positive', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => toReading(parsed('AC 05 00 01 18 02 CA 1A'), times, { g: bad })).toThrow(RangeError);
      expect(() => new Scale(new FakeTransport([]), { resolution: { g: bad } })).toThrow(RangeError);
    }
  });
});

describe('Reading.receivedAtMonotonic', () => {
  it('comes from the monotonic clock, so it never goes backwards when the wall clock does', async () => {
    const transport = new FakeTransport([], false);
    let monotonic = 100;
    const scale = new Scale(transport, { monotonicNow: () => (monotonic += 10) });
    const wall = vi.spyOn(Date, 'now');
    const got: { receivedAt: number; receivedAtMonotonic: number }[] = [];
    scale.onReading((r) => got.push(r));
    await scale.connect();

    wall.mockReturnValue(2_000_000);
    transport.emit(bytes('AC 05 00 01 18 02 CA 1A'));
    // The device clock is set back by an hour between two notifications.
    wall.mockReturnValue(2_000_000 - 3_600_000);
    transport.emit(bytes('AC 05 00 01 18 02 CA 1A'));

    expect(got.map((r) => r.receivedAt)).toEqual([2_000_000, 2_000_000 - 3_600_000]);
    expect(got.map((r) => r.receivedAtMonotonic)).toEqual([110, 120]);
  });

  it('defaults to performance.now()', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(4321.5);
    const transport = new FakeTransport([], false);
    const scale = new Scale(transport);
    const got: number[] = [];
    scale.onReading((r) => got.push(r.receivedAtMonotonic));
    await scale.connect();
    transport.emit(bytes('AC 05 00 01 18 02 CA 1A'));
    expect(got).toEqual([4321.5]);
  });
});
