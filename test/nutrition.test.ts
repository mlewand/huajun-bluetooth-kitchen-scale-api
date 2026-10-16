import { describe, expect, it } from 'vitest';
import { encodeNutrition, Scale, WRITE_CHARACTERISTIC, type Nutrition, type ScaleTransport } from '../src/index.js';
import { alphaFixtures } from './fixtures.alpha.js';
import { bytes, FakeTransport } from './helpers.js';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const sample: Nutrition = { calories: 100, protein: 2, fat: 3, carbohydrate: 4 };
const huajunFrame = bytes('AC 05 00 01 18 02 CA 1A');
const alphaFrame = bytes(alphaFixtures['26_grams_put_and_remove']![0]!);

describe('encodeNutrition', () => {
  it('encodes the frame confirmed on the HUAJUN display', () => {
    // The try-nutrition experiment sent this frame with fiber 5 in the last field; the display
    // showed 100.0 kcal, protein 2.0 g, fat 3.0 g, carbohydrate 4.0 g. Field 5 is fat × 9.
    expect(hex(encodeNutrition(sample))).toBe('AD 01 00 03 E8 00 00 14 00 00 1E 00 00 28 00 01 0E 00 00 00');
  });

  it('rounds to tenths', () => {
    // 123.4 -> 123, 0.6 -> 1, 10.4 -> 10, 2500, fat × 9 = 93.6 -> 94.
    expect(hex(encodeNutrition({ calories: 12.34, protein: 0.06, fat: 1.04, carbohydrate: 250 })))
      .toBe('AD 01 00 00 7B 00 00 01 00 00 0A 00 09 C4 00 00 5E 00 00 00');
  });

  it('takes the 24-bit maximum and caps the undisplayed fat × 9 field there', () => {
    expect(hex(encodeNutrition({ calories: 1677721.5, protein: 0, fat: 1677721.5, carbohydrate: 0 })))
      .toBe('AD 01 FF FF FF 00 00 00 FF FF FF 00 00 00 FF FF FF 00 00 00');
  });

  it.each([-1, NaN, Infinity, 1677721.6])('rejects %s', (bad) => {
    expect(() => encodeNutrition({ ...sample, protein: bad })).toThrow(RangeError);
  });

  it('rejects a missing value', () => {
    expect(() => encodeNutrition({ calories: 1, protein: 1, fat: 1 } as Nutrition)).toThrow(RangeError);
  });

  it('only supports HUAJUN', () => {
    expect(() => encodeNutrition(sample, 'alpha')).toThrow(/only supported on HUAJUN/);
  });
});

describe('Scale.setNutrition', () => {
  const connected = async (options: ConstructorParameters<typeof Scale>[1] = {}, frames: Uint8Array[] = []) => {
    const transport = new FakeTransport([], false);
    const scale = new Scale(transport, options);
    await scale.connect();
    for (const f of frames) transport.emit(f);
    return { scale, transport };
  };

  it('writes the encoded frame to FFB1 once a HUAJUN reading arrived', async () => {
    const { scale, transport } = await connected({}, [huajunFrame]);
    await scale.setNutrition(sample);
    expect(transport.written).toEqual([{ characteristic: WRITE_CHARACTERISTIC, data: encodeNutrition(sample) }]);
  });

  it('identifies HUAJUN from a button press too', async () => {
    const { scale, transport } = await connected({}, [bytes('AC 05 FE 1E 03 00 00 27')]);
    await scale.setNutrition(sample);
    expect(transport.written).toHaveLength(1);
  });

  it("writes before any frame with device: 'huajun'", async () => {
    const { scale, transport } = await connected({ device: 'huajun' });
    await scale.setNutrition(sample);
    expect(transport.written).toHaveLength(1);
  });

  it('refuses while the scale is unidentified', async () => {
    const { scale, transport } = await connected();
    await expect(scale.setNutrition(sample)).rejects.toThrow(/not identified yet/);
    expect(transport.written).toEqual([]);
  });

  it('refuses on alpha, by option or by its frames', async () => {
    for (const { scale, transport } of [await connected({ device: 'alpha' }), await connected({}, [alphaFrame])]) {
      await expect(scale.setNutrition(sample)).rejects.toThrow(/only supported on HUAJUN, not alpha/);
      expect(transport.written).toEqual([]);
    }
  });

  it('refuses out-of-range values without writing', async () => {
    const { scale, transport } = await connected({ device: 'huajun' });
    await expect(scale.setNutrition({ ...sample, fat: -1 })).rejects.toThrow(RangeError);
    expect(transport.written).toEqual([]);
  });

  it('refuses before connect() and after disconnect()', async () => {
    const transport = new FakeTransport([], false);
    const scale = new Scale(transport, { device: 'huajun' });
    await expect(scale.setNutrition(sample)).rejects.toThrow('Not connected');
    await scale.connect();
    await scale.disconnect();
    await expect(scale.setNutrition(sample)).rejects.toThrow('Not connected');
    expect(transport.written).toEqual([]);
  });

  it('refuses when the transport cannot write', async () => {
    const transport: ScaleTransport = {
      connect: async () => {},
      disconnect: async () => {},
      subscribe: async () => {},
      onDisconnect: () => {},
    };
    const scale = new Scale(transport, { device: 'huajun' });
    await scale.connect();
    await expect(scale.setNutrition(sample)).rejects.toThrow('This transport cannot write');
  });
});
