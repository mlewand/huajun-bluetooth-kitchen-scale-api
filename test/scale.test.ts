import { describe, expect, it } from 'vitest';
import { Scale, WEIGHT_CHARACTERISTIC, type Reading } from '../src/index.js';
import { fixtures } from './fixtures.js';
import { bytes, FakeTransport } from './helpers.js';

const collect = async (scale: Scale) => {
  const out: Reading[] = [];
  for await (const r of scale.readings()) out.push(r);
  return out;
};

const replay = (label: string) => fixtures[label]!.map(bytes);

describe('Scale', () => {
  it('subscribes to the weight characteristic only and yields readings until disconnect', async () => {
    const transport = new FakeTransport(replay('test3'));
    const scale = new Scale(transport);
    const collected = collect(scale); // iterate before connect, or early frames are missed
    await scale.connect();
    const readings = await collected;

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
});
