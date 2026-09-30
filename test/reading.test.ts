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

    // ml: the unit is known, but its scale isn't confirmed, so there is no value.
    const ml = toReading(parsed('AC 05 00 00 00 12 CA 1A'), times);
    expect(ml.unit).toBe('ml');
    expect('value' in ml).toBe(false);
    expect('grams' in ml).toBe(false);

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
