import { ALPHA_FRAME_LENGTH, parseAlpha } from './protocols/alpha.js';
import { HUAJUN_FRAME_LENGTH, parseHuajun } from './protocols/huajun.js';

/** GATT service that carries the scale's data (full lowercase 128-bit UUID). */
export const SERVICE_UUID = '0000ffb0-0000-1000-8000-00805f9b34fb';
/** Notify characteristic (`FFB2`) that carries weight frames. The only one the library subscribes to. */
export const WEIGHT_CHARACTERISTIC = '0000ffb2-0000-1000-8000-00805f9b34fb';

/** Display unit of the scale. */
export type Unit = 'g' | 'ml' | 'lb:oz' | 'oz' | 'fl.oz';

/** The scales this library can decode. */
export type DeviceKind = 'huajun' | 'alpha';

/** Advertised Bluetooth name of each supported scale. */
export const DEVICE_NAMES: Record<DeviceKind, string> = { huajun: 'NSCALE', alpha: 'MY_SCALE' };

/** A validated frame. Optional fields are absent (not guessed) when the captures don't confirm them. */
export interface ParsedFrame {
  /** Which scale's decoder produced this frame. */
  device: DeviceKind;
  /**
   * Unsigned magnitude as sent, before any scaling. HUAJUN: bytes 3-4, in 0.1 g or 0.01 oz
   * depending on the unit. alpha: 24 bits, always in milligrams whatever the display unit.
   */
  rawWeight: number;
  /** HUAJUN: byte 5 bit 0, confirmed for grams only (tare, then item removed). alpha: byte 2 bit 7, seen in a single capture. */
  negative: boolean;
  /** Absent for unit codes not seen in captures. */
  unit?: Unit;
  /**
   * Signed weight in `unit`, as the display shows it. Only decoded where a capture confirms the scale.
   * HUAJUN: g (÷10) and oz (÷100); absent for lb:oz, ml and fl.oz.
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
  /** alpha only: byte 1 isn't `0x41`. */
  | { reason: 'unknown-frame-type'; type: number }
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
 * HUAJUN frames are validated for length and the `0xAC` header only (byte 7 has no known
 * checksum). alpha frames are also checked for frame type and checksum.
 */
export function parseFrame(bytes: Uint8Array, device: DeviceKind | 'auto' = 'auto'): ParseResult {
  if (device === 'auto') {
    if (bytes.length === HUAJUN_FRAME_LENGTH) return parseHuajun(bytes);
    if (bytes.length === ALPHA_FRAME_LENGTH) return parseAlpha(bytes);
    return { ok: false, rejection: { reason: 'bad-length', length: bytes.length } };
  }
  return device === 'huajun' ? parseHuajun(bytes) : parseAlpha(bytes);
}
