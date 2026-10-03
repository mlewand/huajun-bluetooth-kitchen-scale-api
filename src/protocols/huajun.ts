import type { ParseResult, ParsedFrame, Unit } from '../parse.js';

/** Unit codes are the high nibble of byte 5 (confirmed by cycling UNIT on an empty scale). */
const UNITS: Record<number, Unit> = { 0: 'g', 1: 'ml', 2: 'lb:oz', 3: 'oz', 4: 'fl.oz' };

const FRAME_LENGTH = 8;
const HEADER = 0xac;
const SCALE: Partial<Record<Unit, number>> = { g: 10, oz: 100 };

/** Length of a HUAJUN frame, used by `parseFrame` to pick the decoder. */
export const HUAJUN_FRAME_LENGTH = FRAME_LENGTH;

/**
 * Decode one 8-byte HUAJUN notification. Only the length and the `0xAC` header are validated;
 * byte 7 has no known checksum.
 */
export function parseHuajun(bytes: Uint8Array): ParseResult {
  if (bytes.length !== FRAME_LENGTH) return { ok: false, rejection: { reason: 'bad-length', length: bytes.length } };
  if (bytes[0] !== HEADER) return { ok: false, rejection: { reason: 'bad-header', header: bytes[0]! } };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawWeight = view.getUint16(3);
  const negative = (bytes[5]! & 1) === 1;
  const unit = UNITS[bytes[5]! >> 4];
  const divisor = unit && SCALE[unit];
  const frame: ParsedFrame = { device: 'huajun', rawWeight, negative, raw: bytes };
  if (unit) frame.unit = unit;
  if (divisor) frame.value = (negative ? -rawWeight : rawWeight) / divisor;
  if (bytes[6] === 0xca) frame.stable = true;
  else if (bytes[6] === 0xce) frame.stable = false;
  return { ok: true, frame };
}
