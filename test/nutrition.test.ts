import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeNutrition, NUTRITION_SUPPORT, Scale, WRITE_CHARACTERISTIC, type DeviceKind, type Nutrition, type ScaleTransport } from '../src/index.js';
import { encodeAlphaNutrition } from '../src/protocols/alpha.js';
import { alphaFixtures } from './fixtures.alpha.js';
import { bytes, FakeTransport } from './helpers.js';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const hexes = (frames: Uint8Array[]) => frames.map(hex);
const sample: Nutrition = { calories: 100, protein: 2, fat: 3, carbohydrate: 4 };
const huajunFrame = bytes('AC 05 00 01 18 02 CA 1A');
const alphaFrame = bytes(alphaFixtures['26_grams_put_and_remove']![0]!);

describe('encodeNutrition (HUAJUN)', () => {
  it('encodes the frame confirmed on the HUAJUN display', () => {
    // The try-nutrition experiment sent this frame with fiber 5 in the last field; the display
    // showed 100.0 kcal, protein 2.0 g, fat 3.0 g, carbohydrate 4.0 g. Field 5 is fat × 9.
    expect(hexes(encodeNutrition(sample))).toEqual(['AD 01 00 03 E8 00 00 14 00 00 1E 00 00 28 00 01 0E 00 00 00']);
  });

  it('rounds to tenths', () => {
    // 123.4 -> 123, 0.6 -> 1, 10.4 -> 10, 2500, fat × 9 = 93.6 -> 94.
    expect(hexes(encodeNutrition({ calories: 12.34, protein: 0.06, fat: 1.04, carbohydrate: 250 }, 'huajun')))
      .toEqual(['AD 01 00 00 7B 00 00 01 00 00 0A 00 09 C4 00 00 5E 00 00 00']);
  });

  it('takes the 24-bit maximum and caps the undisplayed fat × 9 field there', () => {
    expect(hexes(encodeNutrition({ calories: 1677721.5, protein: 0, fat: 1677721.5, carbohydrate: 0 })))
      .toEqual(['AD 01 FF FF FF 00 00 00 FF FF FF 00 00 00 FF FF FF 00 00 00']);
  });
});

describe('encodeNutrition (alpha)', () => {
  it('encodes the two frames confirmed on the alpha display', () => {
    // try-alpha-nutrition sent these 1.3 s after connecting, without a handshake; the display
    // cycled 111 kcal, protein 1.2 g, fat 3.4 g, carbohydrate 5.6 g.
    expect(hexes(encodeNutrition({ calories: 111, protein: 1.2, fat: 3.4, carbohydrate: 5.6 }, 'alpha'))).toEqual([
      'AC 41 02 00 00 00 00 01 04 00 00 00 6F 01 00 00 22 02 D5 70',
      'AC 41 02 01 00 00 38 05 00 00 0C 00 00 00 00 00 00 00 D5 21',
    ]);
  });

  it('reproduces the frames the vendor app sent (HCI snoop log)', () => {
    // FitDays sent food 10121158: 1106 kcal, fat 86.1 g, carbohydrate 0 g, protein 82.9 g.
    expect(hexes(encodeAlphaNutrition({ calories: 1106, protein: 82.9, fat: 86.1, carbohydrate: 0 }, 10121158))).toEqual([
      'AC 41 02 00 00 9A 6F C6 04 00 00 04 52 01 00 03 5D 02 D5 63',
      'AC 41 02 01 00 00 00 05 00 03 3D 00 00 00 00 00 00 00 D5 1D',
    ]);
  });

  it('sends whole kcal and tenths of grams, rounded', () => {
    // 12.6 kcal -> 13; fat 1.04 -> 10; carbohydrate 0.06 -> 1; protein 250 -> 2500.
    const [first, second] = encodeNutrition({ calories: 12.6, protein: 250, fat: 1.04, carbohydrate: 0.06 }, 'alpha');
    // Bytes 9-17 of frame 0: kcal fact (00, 00 00 0D), fat fact (01, 00 00 0A), carbohydrate type 02.
    expect(hex(first!.subarray(9, 18))).toBe('00 00 00 0D 01 00 00 0A 02');
    // Bytes 4-10 of frame 1: the rest of the carbohydrate value (00 00 01), protein fact (05, 00 09 C4).
    expect(hex(second!.subarray(4, 11))).toBe('00 00 01 05 00 09 C4');
  });
});

describe('encodeNutrition validation', () => {
  it.each<DeviceKind>(['huajun', 'alpha'])('rejects out-of-range values on %s', (device) => {
    for (const bad of [-1, NaN, Infinity, 1677721.6]) {
      expect(() => encodeNutrition({ ...sample, protein: bad }, device)).toThrow(RangeError);
    }
  });

  it('rejects a missing value', () => {
    expect(() => encodeNutrition({ calories: 1, protein: 1, fat: 1 } as Nutrition)).toThrow(RangeError);
  });
});

describe('Scale.setNutrition', () => {
  afterEach(() => {
    vi.useRealTimers();
    NUTRITION_SUPPORT.alpha = true;
  });

  /** Connects at monotonic time 0, then moves the clock to `elapsed` ms (past HUAJUN's 3 s delay by default). */
  const connected = async (options: ConstructorParameters<typeof Scale>[1] = {}, frames: Uint8Array[] = [], elapsed = 3000) => {
    const clock = { now: 0 };
    const transport = new FakeTransport([], false);
    const scale = new Scale(transport, { ...options, monotonicNow: () => clock.now });
    await scale.connect();
    clock.now = elapsed;
    for (const f of frames) transport.emit(f);
    return { scale, transport, clock };
  };
  const writtenHex = (transport: FakeTransport) => transport.written.map((w) => hex(w.data));

  it('writes the encoded frame to FFB1 once a HUAJUN reading arrived', async () => {
    const { scale, transport } = await connected({}, [huajunFrame]);
    await expect(scale.setNutrition(sample)).resolves.toBe(true);
    expect(transport.written).toEqual([{ characteristic: WRITE_CHARACTERISTIC, data: encodeNutrition(sample, 'huajun')[0] }]);
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

  it('writes both alpha frames, in order, right after connecting', async () => {
    for (const { scale, transport } of [await connected({ device: 'alpha' }, [], 0), await connected({}, [alphaFrame], 0)]) {
      await expect(scale.setNutrition(sample)).resolves.toBe(true);
      expect(transport.written.map((w) => w.characteristic)).toEqual([WRITE_CHARACTERISTIC, WRITE_CHARACTERISTIC]);
      expect(writtenHex(transport)).toEqual(hexes(encodeNutrition(sample, 'alpha')));
    }
  });

  it('waits for the first frame to identify the scale, then writes for that scale', async () => {
    const { scale, transport } = await connected();
    const sent = scale.setNutrition(sample);
    await Promise.resolve();
    expect(transport.written).toEqual([]);
    transport.emit(alphaFrame);
    await expect(sent).resolves.toBe(true);
    expect(writtenHex(transport)).toEqual(hexes(encodeNutrition(sample, 'alpha')));
  });

  it('rejects without writing when the connection ends before the scale is identified', async () => {
    const { scale, transport } = await connected();
    const sent = scale.setNutrition(sample);
    const failed = expect(sent).rejects.toThrow('Not connected');
    await scale.disconnect();
    await failed;
    expect(transport.written).toEqual([]);
  });

  it('ignores the request on a scale that cannot show nutrition', async () => {
    NUTRITION_SUPPORT.alpha = false;
    for (const { scale, transport } of [await connected({ device: 'alpha' }), await connected({}, [alphaFrame])]) {
      await expect(scale.setNutrition(sample)).resolves.toBe(false);
      expect(transport.written).toEqual([]);
    }
  });

  it('refuses out-of-range values without writing, even before the scale is identified', async () => {
    for (const { scale, transport } of [await connected({ device: 'huajun' }), await connected()]) {
      await expect(scale.setNutrition({ ...sample, fat: -1 })).rejects.toThrow(RangeError);
      expect(transport.written).toEqual([]);
    }
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

  it('waits until 3 s after connect() on HUAJUN, since the scale ignores earlier writes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { scale, transport } = await connected({ device: 'huajun' }, [], 2000);
    const sent = scale.setNutrition(sample);
    await vi.advanceTimersByTimeAsync(999);
    expect(transport.written).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await sent;
    expect(transport.written).toHaveLength(1);
  });

  it('writes in call order, also while waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { scale, transport, clock } = await connected({ device: 'huajun' }, [], 0);
    const second = { calories: 250, protein: 10, fat: 5, carbohydrate: 30 };
    const both = Promise.all([scale.setNutrition(sample), scale.setNutrition(second)]);
    clock.now = 3000; // the monotonic clock moves with the timers
    await vi.advanceTimersByTimeAsync(3000);
    await both;
    expect(transport.written.map((w) => w.data)).toEqual([...encodeNutrition(sample, 'huajun'), ...encodeNutrition(second, 'huajun')]);
  });

  it('rejects without writing when the connection ends while waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { scale, transport } = await connected({ device: 'huajun' }, [], 0);
    const sent = scale.setNutrition(sample);
    const failed = expect(sent).rejects.toThrow('Not connected');
    await scale.disconnect();
    await vi.advanceTimersByTimeAsync(3000);
    await failed;
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
