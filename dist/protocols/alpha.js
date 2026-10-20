/** Unit codes are the high nibble of byte 3 (one capture per unit; fl.oz was never captured on this scale). */
const UNITS = { 0: 'g', 1: 'ml', 2: 'lb:oz', 3: 'oz' };
const FRAME_LENGTH = 20;
const HEADER = 0xac;
/**
 * Byte 1: the device byte the scale reports in every frame (`0x41`; it advertises `0x40`). The
 * library writes it back in byte 1 of its own frames.
 */
const FRAME_TYPE = 0x41;
/** Byte 18 of a weight frame. Other values are other messages (`0xA0` device info, `0xA1` ack, …). */
const WEIGHT = 0xa6;
/** Byte 18 of the nutrition frames the library writes. */
const NUTRITION = 0xd5;
const MG_PER_G = 1000;
const G_PER_OZ = 28.349523125;
/** Length of an alpha frame, used by `parseFrame` to pick the decoder. */
export const ALPHA_FRAME_LENGTH = FRAME_LENGTH;
/** Byte 2: bit 0 stable, bit 7 negative. Bits 1-6 were never set in any capture. */
const STABLE = 0x01;
const NEGATIVE = 0x80;
const UNKNOWN_FLAGS = 0x7e;
/** Low byte of the sum of bytes 2-18: the checksum in byte 19, in both directions. */
function checksum(bytes) {
    let sum = 0;
    for (let i = 2; i < FRAME_LENGTH - 1; i++)
        sum = (sum + bytes[i]) & 0xff;
    return sum;
}
/**
 * Decode one 20-byte alpha (`MY_SCALE`) notification. Validates length, the `0xAC` header, the
 * `0x41` device byte, the checksum (the low byte of the sum of bytes 2-18), and that byte 18 is
 * `0xA6`, the weight frame type; other messages are rejected as `not-weight-frame`.
 *
 * The 24-bit weight in bytes 4-6 is in milligrams whatever the display unit, so `rawWeight` holds
 * it as sent and `value` is converted into the displayed unit.
 */
export function parseAlpha(bytes) {
    if (bytes.length !== FRAME_LENGTH)
        return { ok: false, rejection: { reason: 'bad-length', length: bytes.length } };
    if (bytes[0] !== HEADER)
        return { ok: false, rejection: { reason: 'bad-header', header: bytes[0] } };
    if (bytes[1] !== FRAME_TYPE)
        return { ok: false, rejection: { reason: 'unknown-frame-type', type: bytes[1] } };
    const expected = checksum(bytes);
    const actual = bytes[FRAME_LENGTH - 1];
    if (expected !== actual)
        return { ok: false, rejection: { reason: 'bad-checksum', expected, actual } };
    if (bytes[18] !== WEIGHT)
        return { ok: false, rejection: { reason: 'not-weight-frame', type: bytes[18] } };
    const flags = bytes[2];
    const rawWeight = (bytes[4] << 16) | (bytes[5] << 8) | bytes[6];
    const negative = (flags & NEGATIVE) !== 0;
    const unit = UNITS[bytes[3] >> 4];
    const frame = { device: 'alpha', rawWeight, negative, raw: bytes };
    if (unit)
        frame.unit = unit;
    // Unseen flag bits could change what the other bits mean, so decode no further than what was captured.
    if ((flags & UNKNOWN_FLAGS) !== 0)
        return { ok: true, frame };
    frame.stable = (flags & STABLE) !== 0;
    const grams = rawWeight / MG_PER_G;
    // ml assumes water (1 g = 1 ml); lb:oz has no single-number form, so it has no value.
    const converted = unit === 'g' || unit === 'ml' ? grams : unit === 'oz' ? grams / G_PER_OZ : undefined;
    if (converted !== undefined)
        frame.value = negative && rawWeight !== 0 ? -converted : converted;
    return { ok: true, frame };
}
/** Largest value a nutrition field can carry: 24 bits, in tenths for protein, fat and carbohydrate. */
const MAX_FIELD = 0xffffff;
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
export function encodeAlphaNutrition(n, foodId = 1) {
    const facts = [
        [0, Math.round(n.calories), 'calories'],
        [1, Math.round(n.fat * 10), 'fat'],
        [2, Math.round(n.carbohydrate * 10), 'carbohydrate'],
        [5, Math.round(n.protein * 10), 'protein'],
    ];
    const payload = [(foodId >>> 24) & 0xff, (foodId >>> 16) & 0xff, (foodId >>> 8) & 0xff, foodId & 0xff, facts.length];
    for (const [type, raw, name] of facts) {
        if (!Number.isFinite(raw) || raw < 0 || raw > MAX_FIELD)
            throw new RangeError(`Nutrition ${name} is out of range for alpha, got ${n[name]}`);
        payload.push(type, (raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff);
    }
    const count = Math.ceil(payload.length / 14);
    return Array.from({ length: count }, (_, i) => {
        const frame = new Uint8Array(FRAME_LENGTH);
        frame.set([HEADER, FRAME_TYPE, count, i, ...payload.slice(i * 14, i * 14 + 14)]);
        frame[18] = NUTRITION;
        frame[19] = checksum(frame);
        return frame;
    });
}
