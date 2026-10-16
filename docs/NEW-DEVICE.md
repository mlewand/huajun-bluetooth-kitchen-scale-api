# Adding a device driver

A driver is one pure decoder plus a few table entries. The transports, `Scale` and `toReading()` need no changes. Writing (`setNutrition`) is a separate decision per device: it stays HUAJUN-only until a write is confirmed on the new scale's display. Read [AGENTS.md](../AGENTS.md) first: the library decodes only what captures prove, and writes only what was confirmed on a display.

## 1. Capture and document

1. `npm run capture -- --label <what-you-did> --out captures/<device>` for each scenario: idle, item on and off, TARE, each display unit, a negative weight, a heavy item.
2. Write `captures/<device>/NOTES.md`: advertised name, capacity, display resolution per unit, and what the display showed in every capture. Mark uncertain values as uncertain.
3. Check the GATT layout. Other scales may use another service or characteristic than `SERVICE_UUID` / `WEIGHT_CHARACTERISTIC` (`src/parse.ts`); if so the library needs a per-device UUID before a driver can work, which is a public API change.

## 2. Write the decoder

Create `src/protocols/<device>.ts`, modelled on `alpha.ts` (which validates a checksum) or `huajun.ts`:

- `export function parseX(bytes: Uint8Array): ParseResult`: pure, `Uint8Array`/`DataView` only, no dependencies.
- Validate length, header and anything checkable (frame type, checksum), and return `{ ok: false, rejection }` otherwise. A new rejection reason is a public API change.
- Fill `rawWeight` as sent, `negative` and `raw`. Assign `unit`, `value` and `stable` **conditionally**, only where a capture confirms them: absent beats guessed (`exactOptionalPropertyTypes` is on). No new weight fields on `ParsedFrame`/`Reading`.
- Export the frame length constant (`X_FRAME_LENGTH`) for dispatch.

## 3. Register it

In `src/parse.ts`:

- add the name to `DeviceKind`;
- add its advertised name to `DEVICE_NAMES`;
- add its display resolution per unit to `DEVICE_RESOLUTION`. Units you leave out fall back to `DEFAULT_RESOLUTION` (g 1, ml 1, oz 0.1), so list only what differs. `value` is rounded to this in `toReading()`; see [Resolution](API.md#resolution);
- dispatch in `parseFrame`: the explicit-device branch, and the `'auto'` branch by frame length. If the new frame length equals an existing one, `'auto'` can't tell them apart and needs another rule (document it).
- if the scale reports button presses, add a `parse<X>Button` next to the decoder and dispatch to it in `parseButton`, and reject those frames in the weight decoder as `control-frame` so `Scale` routes them to `onButton`.

Also: the `--device` check in `src/cli/watch.ts` lists the devices by hand, and the `DeviceKind` TSDoc in `src/node/index.ts` and `src/capacitor/index.ts` mentions device names. Transports pick the scan name from `DEVICE_NAMES` and need no change.

## 4. Test

- `test/fixtures.<device>.ts`: the distinct frames of each capture run, copied verbatim, keyed by label.
- `test/parse.<device>.test.ts`: expected decode per frame state, checked against the display values in `NOTES.md`, and a replay of every `captures/<device>/*.jsonl` so a new capture can't be forgotten (see `test/parse.alpha.test.ts`).
- Extend `test/reading.test.ts` / `test/scale.test.ts` for rounding and `Scale` auto-detection.

## 5. Docs and checks

Update, in the same change: TSDoc in `src/`, `docs/API.md` (the device tables, `DEVICE_NAMES`, `DEVICE_RESOLUTION`, `ParsedFrame` field notes), the README intro and protocol table, `TODO.md` (open questions), and the device section in `CLAUDE.md`. Then run `npm run typecheck && npm test`. `npm run watch -- --device <device>` needs the hardware, so ask the user to run it.
