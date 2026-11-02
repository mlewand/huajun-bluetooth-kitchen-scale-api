import { ALPHA_FRAME_LENGTH, encodeAlphaNutrition, parseAlpha } from './protocols/alpha.js';
import { AD_02_FIELDS, encodeHuajunNutrition, HUAJUN_FRAME_LENGTH, MAX_NUTRITION_VALUE, parseHuajun, parseHuajunButton } from './protocols/huajun.js';
export { hasAd02Field } from './protocols/huajun.js';
/** GATT service that carries the scale's data (full lowercase 128-bit UUID). */
export const SERVICE_UUID = '0000ffb0-0000-1000-8000-00805f9b34fb';
/** Notify characteristic (`FFB2`) that carries weight frames. The only one the library subscribes to. */
export const WEIGHT_CHARACTERISTIC = '0000ffb2-0000-1000-8000-00805f9b34fb';
/** Write characteristic (`FFB1`). The only writes the library makes are {@link encodeNutrition}'s frames. */
export const WRITE_CHARACTERISTIC = '0000ffb1-0000-1000-8000-00805f9b34fb';
/**
 * Advertised Bluetooth names of each kind of scale. `huajun`: HUAJUN and one Wozi scale advertise
 * `NSCALE`, the other Wozi scale `SCALE`.
 */
export const DEVICE_NAMES = { huajun: ['NSCALE', 'SCALE'], alpha: ['MY_SCALE'] };
/**
 * Which scales can show nutrition values written by {@link encodeNutrition}. `Scale.setNutrition`
 * ignores the request (writes nothing) for a scale marked `false`.
 */
export const NUTRITION_SUPPORT = { huajun: true, alpha: true };
/** Fallback resolution for units a device's {@link DEVICE_RESOLUTION} entry doesn't list, so a new device only needs an entry where it differs. */
export const DEFAULT_RESOLUTION = { g: 1, ml: 1, oz: 0.1, 'fl.oz': 0.1 };
/**
 * What each scale's display shows: `Reading.value` is rounded to this unless
 * `ScaleOptions.resolution` overrides it. `huajun` is HUAJUN's display. Wozi frames carry fewer
 * decimals (g 0, oz 1), so the rounding leaves them as they are.
 */
export const DEVICE_RESOLUTION = {
    huajun: { g: 0.1, ml: 0.1, oz: 0.01, 'fl.oz': 0.01 },
    alpha: { g: 1, ml: 1, oz: 0.1 },
};
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
export function parseFrame(bytes, device = 'auto') {
    if (device === 'auto') {
        if (bytes.length === HUAJUN_FRAME_LENGTH)
            return parseHuajun(bytes);
        if (bytes.length === ALPHA_FRAME_LENGTH)
            return parseAlpha(bytes);
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
export function parseButton(bytes, device = 'auto') {
    return device === 'alpha' ? undefined : parseHuajunButton(bytes);
}
/**
 * Throw a `RangeError` unless every {@link Nutrition} value is a finite number from 0 to
 * 1677721.5, the range all scales can carry. Optional fields may be left out.
 */
export function checkNutrition(nutrition) {
    const optional = ['fiber', ...AD_02_FIELDS];
    for (const name of ['calories', 'protein', 'fat', 'carbohydrate', ...optional.filter((field) => nutrition[field] !== undefined)]) {
        const v = nutrition[name];
        if (v === undefined || !Number.isFinite(v) || v < 0 || v > MAX_NUTRITION_VALUE)
            throw new RangeError(`Nutrition ${name} must be from 0 to ${MAX_NUTRITION_VALUE}, got ${v}`);
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
export function encodeNutrition(nutrition, device = 'huajun') {
    checkNutrition(nutrition);
    if (!NUTRITION_SUPPORT[device])
        return [];
    return device === 'huajun' ? encodeHuajunNutrition(nutrition) : encodeAlphaNutrition(nutrition);
}
