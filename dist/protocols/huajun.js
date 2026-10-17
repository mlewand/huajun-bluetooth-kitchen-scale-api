/** Unit codes are the high nibble of byte 5 (confirmed by cycling UNIT on an empty scale). */
const UNITS = { 0: 'g', 1: 'ml', 2: 'lb:oz', 3: 'oz', 4: 'fl.oz' };
const FRAME_LENGTH = 8;
const HEADER = 0xac;
const FRAME_TYPE = 0x05;
/** Byte 2 of a control frame (a button event such as `+Plate`) instead of a weight. */
const CONTROL = 0xfe;
/** Byte 3 of a control frame for a button press. */
const BUTTON_EVENT = 0x1e;
/** Byte 4 of a button press (`captures/huajun/rev1/buttons`). */
const BUTTONS = { 0x03: 'plate', 0x04: 'total' };
const SCALE = { g: 10, ml: 10, oz: 100, 'fl.oz': 100 };
/** Length of a HUAJUN frame, used by `parseFrame` to pick the decoder. */
export const HUAJUN_FRAME_LENGTH = FRAME_LENGTH;
/**
 * Decode one 8-byte HUAJUN notification. Validates the length, the `0xAC` header and the `0x05`
 * frame type, and rejects control frames (byte 2 `0xFE`, sent when `+Plate` or `Total` is
 * pressed); byte 7 has no known checksum.
 */
export function parseHuajun(bytes) {
    if (bytes.length !== FRAME_LENGTH)
        return { ok: false, rejection: { reason: 'bad-length', length: bytes.length } };
    if (bytes[0] !== HEADER)
        return { ok: false, rejection: { reason: 'bad-header', header: bytes[0] } };
    if (bytes[1] !== FRAME_TYPE)
        return { ok: false, rejection: { reason: 'unknown-frame-type', type: bytes[1] } };
    if (bytes[2] === CONTROL)
        return { ok: false, rejection: { reason: 'control-frame', type: bytes[3] } };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const rawWeight = view.getUint16(3);
    const negative = (bytes[5] & 1) === 1;
    const unit = UNITS[bytes[5] >> 4];
    const divisor = unit && SCALE[unit];
    const frame = { device: 'huajun', rawWeight, negative, raw: bytes };
    if (unit)
        frame.unit = unit;
    if (divisor)
        frame.value = (negative ? -rawWeight : rawWeight) / divisor;
    if (bytes[6] === 0xca)
        frame.stable = true;
    else if (bytes[6] === 0xce)
        frame.stable = false;
    return { ok: true, frame };
}
/**
 * Decode a HUAJUN button press: `AC 05 FE 1E xx 00 00 ??`, where `xx` is `03` for `+Plate` and
 * `04` for `Total`. Returns `undefined` for anything else, including control frames with another
 * code or non-zero bytes 5-6, which no capture has shown. Byte 7 is ignored, as in weight frames.
 */
export function parseHuajunButton(bytes) {
    if (bytes.length !== FRAME_LENGTH || bytes[0] !== HEADER || bytes[1] !== FRAME_TYPE || bytes[2] !== CONTROL)
        return undefined;
    if (bytes[3] !== BUTTON_EVENT || bytes[5] !== 0 || bytes[6] !== 0)
        return undefined;
    return BUTTONS[bytes[4]];
}
