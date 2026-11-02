import type { Nutrition, ParseResult } from '../parse.js';
/** Length of an alpha frame, used by `parseFrame` to pick the decoder. */
export declare const ALPHA_FRAME_LENGTH = 20;
/**
 * Decode one 20-byte alpha (`MY_SCALE`) notification. Validates length, the `0xAC` header, the
 * `0x41` device byte, the checksum (the low byte of the sum of bytes 2-18), and that byte 18 is
 * `0xA6`, the weight frame type; other messages are rejected as `not-weight-frame`.
 *
 * The 24-bit weight in bytes 4-6 is in milligrams whatever the display unit, so `rawWeight` holds
 * it as sent and `value` is converted into the displayed unit.
 */
export declare function parseAlpha(bytes: Uint8Array): ParseResult;
/**
 * Encode the nutrition command (`0xD5`) that makes the alpha display cycle calories, protein, fat
 * and carbohydrate, as two 20-byte frames to write in order.
 *
 * The payload is `foodId` (u32), a count, then per value `type` (u8) and a 24-bit big-endian value,
 * in the order the vendor app sends them: type 0 kcal (whole kcal), 1 fat, 2 carbohydrate and
 * 5 protein (round(g × 10)). Each frame is `AC 41 <frame count> <index>`, 14 payload bytes
 * (zero-padded), `D5` and the checksum. The scale doesn't seem to use `foodId`. Values are rounded
 * like HUAJUN's, so calories to 1 kcal and the rest to 0.1 g; the vendor app truncates instead.
 */
export declare function encodeAlphaNutrition(n: Nutrition, foodId?: number): Uint8Array[];
