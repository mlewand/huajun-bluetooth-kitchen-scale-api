import { describe, expect, it } from 'vitest';
import { Scale, WEIGHT_CHARACTERISTIC, type Reading } from '../src/index.js';
import { fixtures } from './fixtures.js';
import { alphaFixtures } from './fixtures.alpha.js';
import { bytes, FakeTransport } from './helpers.js';

const collect = async (scale: Scale) => {
  const out: Reading[] = [];
  for await (const r of scale.readings()) out.push(r);
  return out;
};

/** A transport whose connect() fails. */
class FailingTransport extends FakeTransport {
  override async connect() { throw new Error('not found'); }
}

const replay = (label: string) => fixtures[label]!.map(bytes);

describe('Scale', () => {
  it('subscribes to the weight characteristic only and yields readings until disconnect', async () => {
    const transport = new FakeTransport(replay('test3'));
    const scale = new Scale(transport);
    const it = scale.readings(); // created before connect(), not yet iterated
    await scale.connect();
    const readings: Reading[] = [];
    for await (const r of it) readings.push(r);

    expect(transport.subscribedTo).toEqual([WEIGHT_CHARACTERISTIC]);
    expect(readings).toHaveLength(fixtures.test3!.length);
    expect(readings.at(-1)).toMatchObject({ grams: 28, unit: 'g', stable: true });
    expect(readings.at(-1)!.receivedAt).toBeGreaterThan(0);
  });

  it('supports callbacks and unsubscribing', async () => {
    const transport = new FakeTransport([], false);
    const scale = new Scale(transport);
    const got: number[] = [];
    const off = scale.onReading((r) => got.push(r.grams!));
    await scale.connect();
    transport.emit(bytes('AC 05 00 01 18 02 CA 1A'));
    off();
    transport.emit(bytes('AC 05 00 14 88 02 CA 99'));
    expect(got).toEqual([28]);
  });

  it('drops invalid frames, reporting them to onRejected', async () => {
    const rejected: string[] = [];
    const transport = new FakeTransport([bytes('AC 05'), bytes('AC 05 00 01 18 02 CA 1A')]);
    const scale = new Scale(transport, { onRejected: (_, r) => rejected.push(r.reason) });
    const collected = collect(scale);
    await scale.connect();
    const readings = await collected;
    expect(readings).toHaveLength(1);
    expect(rejected).toEqual(['bad-length']);
  });

  it('exposes negative grams and omits grams for other units', async () => {
    const scale = new Scale(new FakeTransport([bytes('AC 05 00 02 CE 03 CA 1A'), bytes('AC 05 00 00 F3 34 CA 1A')]));
    const collected = collect(scale);
    await scale.connect();
    const [neg, oz] = await collected;
    expect(neg!.grams).toBe(-71.8);
    expect(oz).toMatchObject({ unit: 'oz', value: 2.43 });
    expect('grams' in oz!).toBe(false);
  });

  it('ends pending iterators and fires onDisconnect when connect() fails', async () => {
    const scale = new Scale(new FailingTransport([]));
    const collected = collect(scale);
    let disconnects = 0;
    scale.onDisconnect(() => disconnects++);
    await expect(scale.connect()).rejects.toThrow('not found');
    expect(await collected).toEqual([]);
    expect(disconnects).toBe(1);
  });

  it('fires onDisconnect once, for both device drop and disconnect()', async () => {
    const dropped = new Scale(new FakeTransport([]));
    let n = 0;
    dropped.onDisconnect(() => n++);
    await dropped.connect();
    await new Promise((r) => setTimeout(r)); // fake transport disconnects after replay
    expect(n).toBe(1);

    const manual = new Scale(new FakeTransport([], false));
    manual.onDisconnect(() => n++);
    await manual.connect();
    await manual.disconnect();
    expect(n).toBe(2);
  });

  it('keeps delivering readings when a callback throws', async () => {
    const transport = new FakeTransport([], false);
    const scale = new Scale(transport);
    const got: number[] = [];
    scale.onReading(() => { throw new Error('boom'); });
    scale.onReading((r) => got.push(r.grams!));
    await scale.connect();
    transport.emit(bytes('AC 05 00 01 18 02 CA 1A'));
    expect(got).toEqual([28]);
  });
});

describe('Scale with the alpha scale', () => {
  const alpha = (label: string) => alphaFixtures[label]!.map(bytes);

  it('auto-detects alpha frames and tags readings with the device', async () => {
    const scale = new Scale(new FakeTransport(alpha('26_grams_put_and_remove')));
    const collected = collect(scale);
    await scale.connect();
    const readings = await collected;
    expect(readings).toHaveLength(alphaFixtures['26_grams_put_and_remove']!.length);
    expect(new Set(readings.map((r) => r.device))).toEqual(new Set(['alpha']));
    expect(readings.find((r) => r.stable && r.grams)).toMatchObject({ grams: 26.11, unit: 'g' });
  });

  it('auto-detects HUAJUN and alpha frames on one connection', async () => {
    const scale = new Scale(new FakeTransport([bytes('AC 05 00 01 18 02 CA 1A'), ...alpha('44ml_put').slice(0, 1)]));
    const collected = collect(scale);
    await scale.connect();
    expect((await collected).map((r) => r.device)).toEqual(['huajun', 'alpha']);
  });

  it('rejects the other scale\'s frames when a device is given', async () => {
    const rejected: string[] = [];
    const transport = new FakeTransport([bytes('AC 05 00 01 18 02 CA 1A'), ...alpha('44ml_put').slice(0, 1)]);
    const scale = new Scale(transport, { device: 'alpha', onRejected: (_, r) => rejected.push(r.reason) });
    const collected = collect(scale);
    await scale.connect();
    expect((await collected).map((r) => r.device)).toEqual(['alpha']);
    expect(rejected).toEqual(['bad-length']);
  });

  it('reports checksum failures to onRejected', async () => {
    const corrupted = bytes('AC 41 01 00 00 65 FE 00 00 00 00 00 00 00 00 00 00 00 A6 0B');
    const rejected: unknown[] = [];
    const scale = new Scale(new FakeTransport([corrupted]), { onRejected: (_, r) => rejected.push(r) });
    const collected = collect(scale);
    await scale.connect();
    expect(await collected).toEqual([]);
    expect(rejected).toEqual([{ reason: 'bad-checksum', expected: 0x0a, actual: 0x0b }]);
  });
});
