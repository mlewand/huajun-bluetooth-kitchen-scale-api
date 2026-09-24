import { parseFrame, WEIGHT_CHARACTERISTIC, type ParsedFrame, type Rejection, type Unit } from './parse.js';
import type { ScaleTransport } from './transport.js';

export interface Reading {
  /** Weight in grams; present only when the scale is displaying grams. */
  grams?: number;
  /** Signed weight in `unit`; see ParsedFrame.value for when it is decoded. */
  value?: number;
  unit?: Unit;
  stable?: boolean;
  /** The undecoded frame, including the bytes that are not understood. */
  raw: Uint8Array;
  /** Receive time, ms since epoch. */
  receivedAt: number;
}

export interface ScaleOptions {
  /** Called for frames that fail validation. Such frames are otherwise dropped silently. */
  onRejected?: (data: Uint8Array, rejection: Rejection) => void;
}

const toReading = (frame: ParsedFrame, receivedAt: number): Reading => {
  const reading: Reading = { raw: frame.raw, receivedAt };
  if (frame.unit) reading.unit = frame.unit;
  if (frame.value !== undefined) {
    reading.value = frame.value;
    if (frame.unit === 'g') reading.grams = frame.value;
  }
  if (frame.stable !== undefined) reading.stable = frame.stable;
  return reading;
};

/** Read-only: subscribes to weight notifications, never writes to the scale. */
export class Scale {
  #listeners = new Set<(reading: Reading) => void>();
  #closers = new Set<() => void>();

  constructor(private transport: ScaleTransport, private options: ScaleOptions = {}) {}

  async connect(): Promise<void> {
    await this.transport.connect();
    this.transport.onDisconnect(() => this.#closers.forEach((close) => close()));
    await this.transport.subscribe(WEIGHT_CHARACTERISTIC, (data) => this.#handle(data));
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
    this.#closers.forEach((close) => close());
  }

  /** Returns an unsubscribe function. */
  onReading(cb: (reading: Reading) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  /**
   * Yields readings until the scale disconnects or the loop is exited.
   * Frames are only queued once iteration has started, so start the loop before `connect()`.
   */
  async *readings(): AsyncGenerator<Reading, void> {
    const queue: Reading[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    const close = () => { closed = true; wake?.(); };
    const off = this.onReading((r) => { queue.push(r); wake?.(); });
    this.#closers.add(close);
    try {
      while (true) {
        if (queue.length) yield queue.shift()!;
        else if (closed) return;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      off();
      this.#closers.delete(close);
    }
  }

  #handle(data: Uint8Array): void {
    const result = parseFrame(data);
    if (!result.ok) return this.options.onRejected?.(data, result.rejection);
    const reading = toReading(result.frame, Date.now());
    for (const cb of this.#listeners) cb(reading);
  }
}
