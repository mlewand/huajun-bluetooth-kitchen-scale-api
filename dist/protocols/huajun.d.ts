import type { Button, Nutrition, ParseResult } from '../parse.js';
/** Length of a HUAJUN frame, used by `parseFrame` to pick the decoder. */
export declare const HUAJUN_FRAME_LENGTH = 8;
/**
 * Decode one 8-byte notification of the HUAJUN protocol, which Wozi scales also use. Validates the
 * length, the `0xAC` header and the `0x05` frame type, and rejects control frames (byte 2 `0xFE`,
 * sent when `+Plate` or `Total` is pressed). Byte 7 isn't checked: it's a checksum on Wozi (the low
 * byte of the sum of bytes 2-6) but has no known formula on HUAJUN, and a frame doesn't say which
 * scale sent it.
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
/** The fields of the `AD 02` frame, in frame order. */
export declare const AD_02_FIELDS: readonly ["sodium", "sugar", "cholesterol", "potassium", "transFat", "saturatedFat"];
/** Whether `nutrition` gives a field of the `AD 02` frame, so that {@link encodeHuajunNutrition} includes it. */
export declare function hasAd02Field(nutrition: Nutrition): boolean;
/**
 * Encode the frames that set the nutrition counters of a HUAJUN or Wozi display, in write order.
 *
 * `AD 01` holds calories, protein, fat, carbohydrate, energy from fat (fat × 9, capped at the maximum,
 * as the vendor app sends it) and fiber (0 if not given). `AD 02` holds sodium, sugar, cholesterol,
 * potassium, trans fat and saturated fat (0 for those not given), and is included only if at least
 * one of them is given. Values must be in range; `encodeNutrition` checks that.
 */
export declare function encodeHuajunNutrition(n: Nutrition): Uint8Array[];
