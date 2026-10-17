import type { Button, ParseResult } from '../parse.js';
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
