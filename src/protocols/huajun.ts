import type { Button, Nutrition, ParseResult, ParsedFrame, Unit } from '../parse.js';

/** Unit codes are the high nibble of byte 5 (confirmed by cycling UNIT on an empty scale). */
const UNITS: Record<number, Unit> = { 0: 'g', 1: 'ml', 2: 'lb:oz', 3: 'oz', 4: 'fl.oz' };

const FRAME_LENGTH = 8;
const HEADER = 0xac;
const FRAME_TYPE = 0x05;
/** Byte 2 of a control frame (a button event such as `+Plate`) instead of a weight. */
const CONTROL = 0xfe;
/** Byte 3 of a control frame for a button press. */
const BUTTON_EVENT = 0x1e;
/** Byte 4 of a button press (`captures/huajun/rev1/buttons`). */
const BUTTONS: Record<number, Button> = { 0x03: 'plate', 0x04: 'total' };
const SCALE: Partial<Record<Unit, number>> = { g: 10, ml: 10, oz: 100, 'fl.oz': 100 };

/** Length of a HUAJUN frame, used by `parseFrame` to pick the decoder. */
export const HUAJUN_FRAME_LENGTH = FRAME_LENGTH;

/**
 * Decode one 8-byte HUAJUN notification. Validates the length, the `0xAC` header and the `0x05`
 * frame type, and rejects control frames (byte 2 `0xFE`, sent when `+Plate` or `Total` is
 * pressed); byte 7 has no known checksum.
 */
export function parseHuajun(bytes: Uint8Array): ParseResult {
  if (bytes.length !== FRAME_LENGTH) return { ok: false, rejection: { reason: 'bad-length', length: bytes.length } };
  if (bytes[0] !== HEADER) return { ok: false, rejection: { reason: 'bad-header', header: bytes[0]! } };
  if (bytes[1] !== FRAME_TYPE) return { ok: false, rejection: { reason: 'unknown-frame-type', type: bytes[1]! } };
  if (bytes[2] === CONTROL) return { ok: false, rejection: { reason: 'control-frame', type: bytes[3]! } };

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

/**
 * Decode a HUAJUN button press: `AC 05 FE 1E xx 00 00 ??`, where `xx` is `03` for `+Plate` and
 * `04` for `Total`. Returns `undefined` for anything else, including control frames with another
 * code or non-zero bytes 5-6, which no capture has shown. Byte 7 is ignored, as in weight frames.
 */
export function parseHuajunButton(bytes: Uint8Array): Button | undefined {
  if (bytes.length !== FRAME_LENGTH || bytes[0] !== HEADER || bytes[1] !== FRAME_TYPE || bytes[2] !== CONTROL) return undefined;
  if (bytes[3] !== BUTTON_EVENT || bytes[5] !== 0 || bytes[6] !== 0) return undefined;
  return BUTTONS[bytes[4]!];
}

/** Largest value a nutrition field can carry: 24 bits in tenths. */
export const MAX_NUTRITION_VALUE = 0xffffff / 10;

/**
 * Encode the `AD 01` frame that sets the HUAJUN display's nutrition counters: `AD 01`, then six
 * 24-bit big-endian values of round(value × 10), no checksum. The display shows the first four
 * (calories, protein, fat, carbohydrate); the vendor app also sends energy from fat (fat × 9) and
 * fiber, which this scale doesn't display, so they are fat × 9 (capped at the maximum) and 0 here.
 */
export function encodeHuajunNutrition(n: Nutrition): Uint8Array {
  const fields = ['calories', 'protein', 'fat', 'carbohydrate'] as const;
  const values = fields.map((name) => {
    const v = n[name];
    if (!Number.isFinite(v) || v < 0 || v > MAX_NUTRITION_VALUE) throw new RangeError(`Nutrition ${name} must be from 0 to ${MAX_NUTRITION_VALUE}, got ${v}`);
    return v;
  });
  const frame = new Uint8Array(20);
  frame.set([0xad, 0x01]);
  [...values, Math.min(n.fat * 9, MAX_NUTRITION_VALUE), 0].forEach((v, i) => {
    const q = Math.round(v * 10);
    frame.set([(q >> 16) & 0xff, (q >> 8) & 0xff, q & 0xff], 2 + i * 3);
  });
  return frame;
}
