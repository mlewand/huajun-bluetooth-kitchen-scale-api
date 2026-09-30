import { parseFrame, WEIGHT_CHARACTERISTIC, type ParsedFrame, type Rejection, type Unit } from './parse.js';
import type { ScaleTransport } from './transport.js';

/** One decoded weight notification. Fields that aren't decoded are absent, never guessed. */
export interface Reading {
  /** Weight in grams; present only when the scale is displaying grams. */
  grams?: number;
  /** Signed weight in `unit`; see ParsedFrame.value for when it is decoded. */
  value?: number;
  unit?: Unit;
  stable?: boolean;
  /** The undecoded frame, including the bytes that are not understood. */
  raw: Uint8Array;
  /** Receive time, ms since epoch (`Date.now()`). Can jump when the device clock is adjusted. */
  receivedAt: number;
  /**
   * Receive time on a monotonic clock, in ms (`performance.now()` unless
   * {@link ScaleOptions.monotonicNow} says otherwise). Never goes backwards, so use it for
   * durations and ordering; only differences between readings are meaningful, not the value itself.
   */
  receivedAtMonotonic: number;
}

/** Receive times of one notification, for {@link toReading}. */
export interface ReceiveTimes {
  /** ms since epoch. */
  receivedAt: number;
  /** ms on a monotonic clock. */
  receivedAtMonotonic: number;
}

/** Options for {@link Scale}. */
export interface ScaleOptions {
  /** Called for frames that fail validation. Such frames are otherwise dropped silently. */
  onRejected?: (data: Uint8Array, rejection: Rejection) => void;
  /**
   * Monotonic clock for {@link Reading.receivedAtMonotonic}, in ms. Default `performance.now()`,
   * available in browsers, Capacitor web views and Node.
   */
  monotonicNow?: () => number;
}

/**
 * Maps a decoded frame to the {@link Reading} that {@link Scale} delivers for it. Use it with
 * {@link parseFrame} to turn stored raw bytes back into readings, for example to replay a
 * recording with the current version's decoding.
 */
export function toReading(frame: ParsedFrame, times: ReceiveTimes): Reading {
  const reading: Reading = {
    raw: frame.raw,
    receivedAt: times.receivedAt,
    receivedAtMonotonic: times.receivedAtMonotonic,
  };
  if (frame.unit) reading.unit = frame.unit;
  if (frame.value !== undefined) {
    reading.value = frame.value;
    if (frame.unit === 'g') reading.grams = frame.value;
  }
  if (frame.stable !== undefined) reading.stable = frame.stable;
  return reading;
}

const safely = (fn: () => void) => {
  try { fn(); } catch (err) { console.error(err); }
};

/**
 * Live weight readings from the scale over any {@link ScaleTransport}.
 * Read-only: it subscribes to weight notifications and never writes to the scale.
 * One instance covers one connection; create a new `Scale` to reconnect.
 */
export class Scale {
  #listeners = new Set<(reading: Reading) => void>();
  #disconnectListeners = new Set<() => void>();
  #closers = new Set<() => void>();
  #open = false;

  constructor(private transport: ScaleTransport, private options: ScaleOptions = {}) {}

  /** Connect and start delivering readings. If this rejects, pending `readings()` iterators end and `onDisconnect` callbacks fire. */
  async connect(): Promise<void> {
    this.#open = true;
    try {
      await this.transport.connect();
      this.transport.onDisconnect(() => this.#close());
      await this.transport.subscribe(WEIGHT_CHARACTERISTIC, (data) => this.#handle(data));
    } catch (err) {
      this.#close();
      throw err;
    }
  }

  /** Disconnect. Ends pending `readings()` iterators and fires `onDisconnect` callbacks. */
  async disconnect(): Promise<void> {
    await this.transport.disconnect();
    this.#close();
  }

  /** Call `cb` for every valid reading. Returns an unsubscribe function. A throwing callback is logged and doesn't affect others. */
  onReading(cb: (reading: Reading) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  /** Fires once when the connection ends (device disconnect, `disconnect()`, or failed `connect()`). Returns an unsubscribe function. */
  onDisconnect(cb: () => void): () => void {
    this.#disconnectListeners.add(cb);
    return () => this.#disconnectListeners.delete(cb);
  }

  /**
   * Readings from the moment this is called (so it may be called before `connect()`), until the
   * connection ends or the loop is exited. Not reusable across reconnects.
   */
  readings(): AsyncIterableIterator<Reading> {
    const queue: Reading[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    const close = () => { closed = true; wake?.(); };
    const off = this.onReading((r) => { queue.push(r); wake?.(); });
    this.#closers.add(close);
    const cleanup = () => { off(); this.#closers.delete(close); };

    return {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        while (!queue.length && !closed) await new Promise<void>((resolve) => (wake = resolve));
        if (queue.length) return { done: false, value: queue.shift()! };
        cleanup();
        return { done: true, value: undefined };
      },
      async return() {
        cleanup();
        return { done: true, value: undefined };
      },
    };
  }

  #close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#closers.forEach((close) => close());
    this.#disconnectListeners.forEach((cb) => safely(cb));
  }

  #handle(data: Uint8Array): void {
    const result = parseFrame(data);
    if (!result.ok) return this.options.onRejected?.(data, result.rejection);
    const monotonicNow = this.options.monotonicNow ?? (() => performance.now());
    const reading = toReading(result.frame, { receivedAt: Date.now(), receivedAtMonotonic: monotonicNow() });
    for (const cb of this.#listeners) safely(() => cb(reading));
  }
}
