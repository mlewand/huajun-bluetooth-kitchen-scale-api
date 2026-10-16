import { ALPHA_FRAME_LENGTH, parseAlpha } from './protocols/alpha.js';
import { encodeHuajunNutrition, HUAJUN_FRAME_LENGTH, parseHuajun, parseHuajunButton } from './protocols/huajun.js';

/** GATT service that carries the scale's data (full lowercase 128-bit UUID). */
export const SERVICE_UUID = '0000ffb0-0000-1000-8000-00805f9b34fb';
/** Notify characteristic (`FFB2`) that carries weight frames. The only one the library subscribes to. */
export const WEIGHT_CHARACTERISTIC = '0000ffb2-0000-1000-8000-00805f9b34fb';

/** Write characteristic (`FFB1`). The only write the library makes is {@link encodeNutrition}'s frame, on HUAJUN. */
export const WRITE_CHARACTERISTIC = '0000ffb1-0000-1000-8000-00805f9b34fb';

/** Display unit of the scale. */
export type Unit = 'g' | 'ml' | 'lb:oz' | 'oz' | 'fl.oz';

/** The scales this library can decode. */
export type DeviceKind = 'huajun' | 'alpha';

/** A button on the scale that reports its presses: HUAJUN `+Plate` (`'plate'`) and `Total` (`'total'`). */
export type Button = 'plate' | 'total';

/**
 * Values for the HUAJUN display's nutrition counters, in the units the display shows. Each must be
 * from 0 to 1677721.5; the scale stores tenths, so values are rounded to 0.1.
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
}

/** Advertised Bluetooth name of each supported scale. */
export const DEVICE_NAMES: Record<DeviceKind, string> = { huajun: 'NSCALE', alpha: 'MY_SCALE' };

/** Step size per display unit that a weight is rounded to, in that unit (for example `{ g: 0.1 }`). */
export type Resolution = Partial<Record<Unit, number>>;

/** Fallback resolution for units a device's {@link DEVICE_RESOLUTION} entry doesn't list, so a new device only needs an entry where it differs. */
export const DEFAULT_RESOLUTION: Readonly<Resolution> = { g: 1, ml: 1, oz: 0.1, 'fl.oz': 0.1 };

/** What each scale's display shows: `Reading.value` is rounded to this unless `ScaleOptions.resolution` overrides it. */
export const DEVICE_RESOLUTION: Record<DeviceKind, Readonly<Resolution>> = {
  huajun: { g: 0.1, ml: 0.1, oz: 0.01, 'fl.oz': 0.01 },
  alpha: { g: 1, ml: 1, oz: 0.1 },
};

/** A validated frame. Optional fields are absent (not guessed) when the captures don't confirm them. */
export interface ParsedFrame {
  /** Which scale's decoder produced this frame. */
  device: DeviceKind;
  /**
   * Unsigned magnitude as sent, before any scaling. HUAJUN: bytes 3-4, in 0.1 g, 0.1 ml,
   * 0.01 oz or 0.01 fl.oz depending on the unit. alpha: 24 bits, always in milligrams whatever the display unit.
   */
  rawWeight: number;
  /** HUAJUN: byte 5 bit 0, confirmed for grams only (tare, then item removed). alpha: byte 2 bit 7, seen in a single capture. */
  negative: boolean;
  /** Absent for unit codes not seen in captures. */
  unit?: Unit;
  /**
   * Signed weight in `unit`. Full precision, not rounded to the display (`toReading` does that). Only decoded where a capture confirms the scale.
   * HUAJUN: g and ml (÷10), oz and fl.oz (÷100); absent for lb:oz.
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
  /** Byte 1 isn't the frame type: `0x05` for HUAJUN, `0x41` for alpha. */
  | { reason: 'unknown-frame-type'; type: number }
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
 * frames (button events) are rejected as `control-frame`, and HUAJUN frames have no checksum
 * (byte 7 has no known formula). alpha frames are also checked for their checksum.
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
 * Encode the frame that sets the scale's nutrition counters, to be written to
 * {@link WRITE_CHARACTERISTIC}. Pure and platform-agnostic; `Scale.setNutrition` uses it.
 *
 * Only HUAJUN is supported (confirmed on its display), so `device` must be `'huajun'`. Throws a
 * `RangeError` if a value isn't a finite number from 0 to 1677721.5.
 */
export function encodeNutrition(nutrition: Nutrition, device: DeviceKind = 'huajun'): Uint8Array {
  if (device !== 'huajun') throw new Error(`Writing nutrition is only supported on HUAJUN, not ${device}`);
  return encodeHuajunNutrition(nutrition);
}
