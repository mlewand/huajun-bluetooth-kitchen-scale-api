import type { ParseResult } from '../parse.js';
/** Length of an alpha frame, used by `parseFrame` to pick the decoder. */
export declare const ALPHA_FRAME_LENGTH = 20;
/**
 * Decode one 20-byte alpha (`MY_SCALE`) notification. Validates length, the `0xAC` header, the
 * `0x41` frame type and the checksum, which is the low byte of the sum of bytes 2-18.
 *
 * The 24-bit weight in bytes 4-6 is in milligrams whatever the display unit, so `rawWeight` holds
 * it as sent and `value` is converted into the displayed unit.
 */
export declare function parseAlpha(bytes: Uint8Array): ParseResult;
