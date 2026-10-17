import type { Button, Nutrition, ParseResult } from '../parse.js';
/** Length of a HUAJUN frame, used by `parseFrame` to pick the decoder. */
export declare const HUAJUN_FRAME_LENGTH = 8;
/**
 * Decode one 8-byte HUAJUN notification. Validates the length, the `0xAC` header and the `0x05`
 * frame type, and rejects control frames (byte 2 `0xFE`, sent when `+Plate` or `Total` is
 * pressed); byte 7 has no known checksum.
 */
export declare function parseHuajun(bytes: Uint8Array): ParseResult;
/**
 * Decode a HUAJUN button press: `AC 05 FE 1E xx 00 00 ??`, where `xx` is `03` for `+Plate` and
 * `04` for `Total`. Returns `undefined` for anything else, including control frames with another
 * code or non-zero bytes 5-6, which no capture has shown. Byte 7 is ignored, as in weight frames.
 */
export declare function parseHuajunButton(bytes: Uint8Array): Button | undefined;
/** Largest value a nutrition field can carry: 24 bits in tenths. */
export declare const MAX_NUTRITION_VALUE: number;
/**
 * Encode the `AD 01` frame that sets the HUAJUN display's nutrition counters: `AD 01`, then six
 * 24-bit big-endian values of round(value × 10), no checksum. The display shows the first four
 * (calories, protein, fat, carbohydrate); the vendor app also sends energy from fat (fat × 9) and
 * fiber, which this scale doesn't display, so they are fat × 9 (capped at the maximum) and 0 here.
 */
export declare function encodeHuajunNutrition(n: Nutrition): Uint8Array;
