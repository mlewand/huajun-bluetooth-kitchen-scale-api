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

/** Length of a HUAJUN frame, used by `parseFrame` to pick the decoder. */
export const HUAJUN_FRAME_LENGTH = FRAME_LENGTH;

/**
 * Decode one 8-byte notification of the HUAJUN protocol, which Wozi scales also use. Validates the
 * length, the `0xAC` header and the `0x05` frame type, and rejects control frames (byte 2 `0xFE`,
 * sent when `+Plate` or `Total` is pressed). Byte 7 isn't checked: it's a checksum on Wozi (the low
 * byte of the sum of bytes 2-6) but has no known formula on HUAJUN, and a frame doesn't say which
 * scale sent it.
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
  // Byte 5 bits 1-3 count the weight's decimals. HUAJUN sends 1 for g and ml, 2 for oz and fl.oz; Wozi 0 for g, 1 for oz.
  const decimals = (bytes[5]! >> 1) & 7;
  const frame: ParsedFrame = { device: 'huajun', rawWeight, negative, raw: bytes };
  if (unit) frame.unit = unit;
  // lb:oz has no single-number form, so it has no value.
  if (unit && unit !== 'lb:oz') frame.value = (negative ? -rawWeight : rawWeight) / 10 ** decimals;
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

/** The fields of the `AD 02` frame, in frame order. */
export const AD_02_FIELDS = ['sodium', 'sugar', 'cholesterol', 'potassium', 'transFat', 'saturatedFat'] as const;

/** Whether `nutrition` gives a field of the `AD 02` frame, so that {@link encodeHuajunNutrition} includes it. */
export function hasAd02Field(nutrition: Nutrition): boolean {
  return AD_02_FIELDS.some((name) => nutrition[name] !== undefined);
}

/** One 20-byte nutrition frame: `AD <group>`, then six 24-bit big-endian values of round(value × 10), no checksum. */
function nutritionFrame(group: number, values: number[]): Uint8Array {
  const frame = new Uint8Array(20);
  frame.set([0xad, group]);
  values.forEach((v, i) => {
    const q = Math.round(v * 10);
    frame.set([(q >> 16) & 0xff, (q >> 8) & 0xff, q & 0xff], 2 + i * 3);
  });
  return frame;
}

/**
 * Encode the frames that set the nutrition counters of a HUAJUN or Wozi display, in write order.
 *
 * `AD 01` holds calories, protein, fat, carbohydrate, energy from fat (fat × 9, capped at the maximum,
 * as the vendor app sends it) and fiber (0 if not given). `AD 02` holds sodium, sugar, cholesterol,
 * potassium, trans fat and saturated fat (0 for those not given), and is included only if at least
 * one of them is given. Values must be in range; `encodeNutrition` checks that.
 */
export function encodeHuajunNutrition(n: Nutrition): Uint8Array[] {
  const frames = [nutritionFrame(0x01, [n.calories, n.protein, n.fat, n.carbohydrate, Math.min(n.fat * 9, MAX_NUTRITION_VALUE), n.fiber ?? 0])];
  if (hasAd02Field(n)) frames.push(nutritionFrame(0x02, AD_02_FIELDS.map((name) => n[name] ?? 0)));
  return frames;
}
