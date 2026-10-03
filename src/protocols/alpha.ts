import type { ParseResult, ParsedFrame, Unit } from '../parse.js';

/** Unit codes are the high nibble of byte 3 (one capture per unit; fl.oz was never captured on this scale). */
const UNITS: Record<number, Unit> = { 0: 'g', 1: 'ml', 2: 'lb:oz', 3: 'oz' };

const FRAME_LENGTH = 20;
const HEADER = 0xac;
const FRAME_TYPE = 0x41;
const MG_PER_G = 1000;
const G_PER_OZ = 28.349523125;

/** Length of an alpha frame, used by `parseFrame` to pick the decoder. */
export const ALPHA_FRAME_LENGTH = FRAME_LENGTH;

/** Byte 2: bit 0 stable, bit 7 negative. Bits 1-6 were never set in any capture. */
const STABLE = 0x01;
const NEGATIVE = 0x80;
const UNKNOWN_FLAGS = 0x7e;

/**
 * Decode one 20-byte alpha (`MY_SCALE`) notification. Validates length, the `0xAC` header, the
 * `0x41` frame type and the checksum, which is the low byte of the sum of bytes 2-18.
 *
 * The 24-bit weight in bytes 4-6 is in milligrams whatever the display unit, so `rawWeight` holds
 * it as sent and `value` is converted into the displayed unit.
 */
export function parseAlpha(bytes: Uint8Array): ParseResult {
  if (bytes.length !== FRAME_LENGTH) return { ok: false, rejection: { reason: 'bad-length', length: bytes.length } };
  if (bytes[0] !== HEADER) return { ok: false, rejection: { reason: 'bad-header', header: bytes[0]! } };
  if (bytes[1] !== FRAME_TYPE) return { ok: false, rejection: { reason: 'unknown-frame-type', type: bytes[1]! } };

  let expected = 0;
  for (let i = 2; i < FRAME_LENGTH - 1; i++) expected = (expected + bytes[i]!) & 0xff;
  const actual = bytes[FRAME_LENGTH - 1]!;
  if (expected !== actual) return { ok: false, rejection: { reason: 'bad-checksum', expected, actual } };

  const flags = bytes[2]!;
  const rawWeight = (bytes[4]! << 16) | (bytes[5]! << 8) | bytes[6]!;
  const negative = (flags & NEGATIVE) !== 0;
  const unit = UNITS[bytes[3]! >> 4];
  const frame: ParsedFrame = { device: 'alpha', rawWeight, negative, raw: bytes };
  if (unit) frame.unit = unit;
  // Unseen flag bits could change what the other bits mean, so decode no further than what was captured.
  if ((flags & UNKNOWN_FLAGS) !== 0) return { ok: true, frame };

  frame.stable = (flags & STABLE) !== 0;
  const grams = rawWeight / MG_PER_G;
  // ml assumes water (1 g = 1 ml); lb:oz has no single-number form, so it has no value.
  const converted = unit === 'g' || unit === 'ml' ? grams : unit === 'oz' ? grams / G_PER_OZ : undefined;
  if (converted !== undefined) frame.value = negative && rawWeight !== 0 ? -converted : converted;
  return { ok: true, frame };
}
