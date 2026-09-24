export const SERVICE_UUID = '0000ffb0-0000-1000-8000-00805f9b34fb';
export const WEIGHT_CHARACTERISTIC = '0000ffb2-0000-1000-8000-00805f9b34fb';

export type Unit = 'g' | 'ml' | 'lb:oz' | 'oz' | 'fl.oz';

/** Unit codes are the high nibble of byte 5 (confirmed by cycling UNIT on an empty scale). */
const UNITS: Record<number, Unit> = { 0: 'g', 1: 'ml', 2: 'lb:oz', 3: 'oz', 4: 'fl.oz' };

export interface ParsedFrame {
  /** Unsigned magnitude from bytes 3-4 (big-endian), before any scaling. */
  rawWeight: number;
  /** Byte 5 bit 0. Confirmed for grams only (tare, then item removed). */
  negative: boolean;
  /** Absent for unit codes not seen in captures. */
  unit?: Unit;
  /**
   * Signed weight in `unit`. Only decoded where a capture confirms the scale:
   * g (÷10) and oz (÷100). Absent for lb:oz, ml and fl.oz.
   */
  value?: number;
  /** Byte 6: 0xCA stable, 0xCE changing. Absent for other values. */
  stable?: boolean;
  /** Byte 7 is unknown (not a checksum of the other bytes); use `raw`. */
  raw: Uint8Array;
}

export type Rejection =
  | { reason: 'bad-length'; length: number }
  | { reason: 'bad-header'; header: number };

export type ParseResult = { ok: true; frame: ParsedFrame } | { ok: false; rejection: Rejection };

const FRAME_LENGTH = 8;
const HEADER = 0xac;
const SCALE: Partial<Record<Unit, number>> = { g: 10, oz: 100 };

export function parseFrame(bytes: Uint8Array): ParseResult {
  if (bytes.length !== FRAME_LENGTH) return { ok: false, rejection: { reason: 'bad-length', length: bytes.length } };
  if (bytes[0] !== HEADER) return { ok: false, rejection: { reason: 'bad-header', header: bytes[0]! } };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawWeight = view.getUint16(3);
  const negative = (bytes[5]! & 1) === 1;
  const unit = UNITS[bytes[5]! >> 4];
  const divisor = unit && SCALE[unit];
  const frame: ParsedFrame = { rawWeight, negative, raw: bytes };
  if (unit) frame.unit = unit;
  if (divisor) frame.value = (negative ? -rawWeight : rawWeight) / divisor;
  if (bytes[6] === 0xca) frame.stable = true;
  else if (bytes[6] === 0xce) frame.stable = false;
  return { ok: true, frame };
}
