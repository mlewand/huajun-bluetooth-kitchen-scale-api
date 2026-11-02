import { ALPHA_FRAME_LENGTH, encodeAlphaNutrition, parseAlpha } from './protocols/alpha.js';
import { AD_02_FIELDS, encodeHuajunNutrition, HUAJUN_FRAME_LENGTH, MAX_NUTRITION_VALUE, parseHuajun, parseHuajunButton } from './protocols/huajun.js';

export { hasAd02Field } from './protocols/huajun.js';

/** GATT service that carries the scale's data (full lowercase 128-bit UUID). */
export const SERVICE_UUID = '0000ffb0-0000-1000-8000-00805f9b34fb';
/** Notify characteristic (`FFB2`) that carries weight frames. The only one the library subscribes to. */
export const WEIGHT_CHARACTERISTIC = '0000ffb2-0000-1000-8000-00805f9b34fb';

/** Write characteristic (`FFB1`). The only writes the library makes are {@link encodeNutrition}'s frames. */
export const WRITE_CHARACTERISTIC = '0000ffb1-0000-1000-8000-00805f9b34fb';

/** Display unit of the scale. */
export type Unit = 'g' | 'ml' | 'lb:oz' | 'oz' | 'fl.oz';

/**
 * The scales this library can decode. `'huajun'` also covers Wozi scales, which advertise the same
 * name and use the same protocol.
 */
export type DeviceKind = 'huajun' | 'alpha';

/** A button on the scale that reports its presses: HUAJUN `+Plate` (`'plate'`) and `Total` (`'total'`). */
export type Button = 'plate' | 'total';

/**
 * Nutrition values to show on the scale's display, for {@link encodeNutrition} and
 * `Scale.setNutrition`. Each must be a finite number from 0 to 1677721.5. Everything is rounded to
 * 0.1, except that alpha sends calories in whole kcal.
 *
 * The optional fields only reach Wozi displays; HUAJUN has no counters for them and alpha ignores
 * them. The Wozi scale advertised as `NSCALE` shows all of them. The one advertised as `SCALE` shows
 * fiber, sodium and cholesterol only. A field left out shows 0.
 */
export interface Nutrition {
  /** Energy, kcal. */
  calories: number;
  /** Protein, g. */
  protein: number;
  /** Fat, g. */
  fat: number;
  /** Carbohydrate, g. */
  carbohydrate: number;
  /** Fiber, g. */
  fiber?: number;
  /** Sodium, mg. */
  sodium?: number;
  /** Sugar, g. */
  sugar?: number;
  /** Cholesterol, mg. */
  cholesterol?: number;
  /** Potassium, mg. */
  potassium?: number;
  /** Trans fat, g. */
  transFat?: number;
  /** Saturated fat, g. */
  saturatedFat?: number;
}

/**
 * Advertised Bluetooth names of each kind of scale. `huajun`: HUAJUN and one Wozi scale advertise
 * `NSCALE`, the other Wozi scale `SCALE`.
 */
export const DEVICE_NAMES: Record<DeviceKind, readonly string[]> = { huajun: ['NSCALE', 'SCALE'], alpha: ['MY_SCALE'] };

/**
 * Which scales can show nutrition values written by {@link encodeNutrition}. `Scale.setNutrition`
 * ignores the request (writes nothing) for a scale marked `false`.
 */
export const NUTRITION_SUPPORT: Record<DeviceKind, boolean> = { huajun: true, alpha: true };

/** Step size per display unit that a weight is rounded to, in that unit (for example `{ g: 0.1 }`). */
export type Resolution = Partial<Record<Unit, number>>;

/** Fallback resolution for units a device's {@link DEVICE_RESOLUTION} entry doesn't list, so a new device only needs an entry where it differs. */
export const DEFAULT_RESOLUTION: Readonly<Resolution> = { g: 1, ml: 1, oz: 0.1, 'fl.oz': 0.1 };

/**
 * What each scale's display shows: `Reading.value` is rounded to this unless
 * `ScaleOptions.resolution` overrides it. `huajun` is HUAJUN's display. Wozi frames carry fewer
 * decimals (g 0, oz 1), so the rounding leaves them as they are.
 */
export const DEVICE_RESOLUTION: Record<DeviceKind, Readonly<Resolution>> = {
  huajun: { g: 0.1, ml: 0.1, oz: 0.01, 'fl.oz': 0.01 },
  alpha: { g: 1, ml: 1, oz: 0.1 },
};

/** A validated frame. Optional fields are absent (not guessed) when the captures don't confirm them. */
export interface ParsedFrame {
  /** Which scale's decoder produced this frame. */
  device: DeviceKind;
  /**
   * Unsigned magnitude as sent, before any scaling. HUAJUN and Wozi: bytes 3-4, with as many decimals
   * as byte 5 bits 1-3 say (HUAJUN 0.1 g, 0.1 ml, 0.01 oz or 0.01 fl.oz; Wozi 1 g or 0.1 oz).
   * alpha: 24 bits, always in milligrams whatever the display unit.
   */
  rawWeight: number;
  /** HUAJUN: byte 5 bit 0, confirmed for grams only (tare, then item removed). alpha: byte 2 bit 7, seen in a single capture. */
  negative: boolean;
  /** Absent for unit codes not seen in captures. */
  unit?: Unit;
  /**
   * Signed weight in `unit`. Full precision, not rounded to the display (`toReading` does that). Only decoded where a capture confirms the scale.
   * HUAJUN and Wozi: g, ml, oz and fl.oz, `rawWeight` ÷ 10^(byte 5 bits 1-3); absent for lb:oz.
   * alpha: g, oz and ml, converted from milligrams (ml assumes water, 1 g = 1 ml); absent for lb:oz.
   */
  value?: number;
  /**
   * HUAJUN: byte 6, `0xCA` stable, `0xCE` changing; absent for other values.
   * alpha: byte 2 bit 0; absent if bits 1-6 of byte 2 are set, which no capture has shown.
   */
  stable?: boolean;
  /** The original bytes (8 for HUAJUN, 20 for alpha), including the ones that are not decoded. */
  raw: Uint8Array;
}

/** Why a frame failed validation. */
export type Rejection =
  | { reason: 'bad-length'; length: number }
  | { reason: 'bad-header'; header: number }
  /** Byte 1 isn't the frame type: `0x05` for HUAJUN, the `0x41` device byte for alpha. */
  | { reason: 'unknown-frame-type'; type: number }
  /**
   * alpha only: a valid frame whose type in byte 18 isn't `0xA6` (weight), for example `0xA0`
   * device info. `type` is byte 18.
   */
  | { reason: 'not-weight-frame'; type: number }
  /**
   * HUAJUN only: byte 2 is `0xFE`, a control frame rather than a weight. `type` is byte 3 (`0x1E`
   * for button presses). {@link parseButton} decodes the known buttons, and `Scale` delivers those
   * to `onButton` instead of `onRejected`.
   */
  | { reason: 'control-frame'; type: number }
  /** alpha only: the sum of bytes 2-18 doesn't match byte 19. */
  | { reason: 'bad-checksum'; expected: number; actual: number };

/** Result of {@link parseFrame}: the decoded frame, or the reason it was rejected. */
export type ParseResult = { ok: true; frame: ParsedFrame } | { ok: false; rejection: Rejection };

/**
 * Decode one notification from {@link WEIGHT_CHARACTERISTIC}. Pure and platform-agnostic.
 *
 * With `device` `'auto'` (the default) the frame length picks the decoder: 8 bytes is HUAJUN,
 * 20 bytes is alpha, anything else is rejected as `bad-length`. With an explicit device only that
 * decoder runs, so a frame of the other scale is rejected as `bad-length`.
 *
 * Both decoders validate length, the `0xAC` header and the frame type in byte 1. HUAJUN control
 * frames (button events) are rejected as `control-frame`, and HUAJUN frames get no checksum check:
 * byte 7 is one on Wozi but has no known formula on HUAJUN, and a frame doesn't say which scale sent
 * it. alpha frames are also checked for their checksum, and frames other than weights (byte 18
 * isn't `0xA6`) are rejected as `not-weight-frame`.
 */
export function parseFrame(bytes: Uint8Array, device: DeviceKind | 'auto' = 'auto'): ParseResult {
  if (device === 'auto') {
    if (bytes.length === HUAJUN_FRAME_LENGTH) return parseHuajun(bytes);
    if (bytes.length === ALPHA_FRAME_LENGTH) return parseAlpha(bytes);
    return { ok: false, rejection: { reason: 'bad-length', length: bytes.length } };
  }
  return device === 'huajun' ? parseHuajun(bytes) : parseAlpha(bytes);
}

/**
 * Decode a button press from one notification of {@link WEIGHT_CHARACTERISTIC}, or `undefined` if
 * the frame isn't one. Pure and platform-agnostic, like {@link parseFrame}, which rejects these
 * frames as `control-frame`.
 *
 * Only HUAJUN reports buttons: `+Plate` and `Total`, the only codes captured. `device` works as in
 * `parseFrame`, so `'alpha'` always returns `undefined`.
 */
export function parseButton(bytes: Uint8Array, device: DeviceKind | 'auto' = 'auto'): Button | undefined {
  return device === 'alpha' ? undefined : parseHuajunButton(bytes);
}

/**
 * Throw a `RangeError` unless every {@link Nutrition} value is a finite number from 0 to
 * 1677721.5, the range all scales can carry. Optional fields may be left out.
 */
export function checkNutrition(nutrition: Nutrition): void {
  const optional = ['fiber', ...AD_02_FIELDS] as const;
  for (const name of ['calories', 'protein', 'fat', 'carbohydrate', ...optional.filter((field) => nutrition[field] !== undefined)] as const) {
    const v = nutrition[name];
    if (v === undefined || !Number.isFinite(v) || v < 0 || v > MAX_NUTRITION_VALUE) throw new RangeError(`Nutrition ${name} must be from 0 to ${MAX_NUTRITION_VALUE}, got ${v}`);
  }
}

/**
 * Encode the frames that show `nutrition` on the scale's display, to be written to
 * {@link WRITE_CHARACTERISTIC} in order. Pure and platform-agnostic; `Scale.setNutrition` uses it.
 *
 * - HUAJUN and Wozi: the `AD 01` frame that sets the display's nutrition counters, followed by the
 *   `AD 02` frame if `sodium`, `sugar`, `cholesterol`, `potassium`, `transFat` or `saturatedFat` is
 *   given. HUAJUN keeps the values until the connection ends. Leave 1 s between the frames: that's
 *   the only spacing confirmed, and `Scale.setNutrition` does it for you.
 * - alpha: the two frames of its nutrition command; the display then cycles calories, protein, fat
 *   and carbohydrate twice and returns to the weight. The optional fields are ignored.
 *
 * Returns an empty list for a scale that can't show nutrition ({@link NUTRITION_SUPPORT}). Throws a
 * `RangeError` if a value isn't a finite number from 0 to 1677721.5.
 */
export function encodeNutrition(nutrition: Nutrition, device: DeviceKind = 'huajun'): Uint8Array[] {
  checkNutrition(nutrition);
  if (!NUTRITION_SUPPORT[device]) return [];
  return device === 'huajun' ? encodeHuajunNutrition(nutrition) : encodeAlphaNutrition(nutrition);
}
