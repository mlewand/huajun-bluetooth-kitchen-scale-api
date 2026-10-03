# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm test` runs all vitest tests. For a single file use `npx vitest run test/parse.test.ts`, and for a single test add `-t "<name>"`.
- `npm run typecheck` runs `tsc` over `src`, `test` and `demo` with no emit.
- `npm run build` runs `tsc -p tsconfig.build.json` and writes to `dist/`. `src/cli` is excluded, so CLI code never ships.
- `npm run capture -- --label x [--out captures/huajun]`, `npm run watch` and `npm run demo` need real hardware. You can't verify them here, so typecheck them and leave hardware testing to the user.

## Architecture

The library has three layers, and each entry point maps to a `package.json` subpath export:

1. **`src/parse.ts`** holds the pure decoder entry point (`src/protocols/` has one decoder per scale). `parseFrame()` returns a discriminated `ParseResult` (`{ ok: true, frame }` or `{ ok: false, rejection }`). Fields the captures don't confirm stay *absent* rather than `undefined` or guessed, which is why the code assigns them conditionally (`exactOptionalPropertyTypes` is on). It also holds the UUID constants, the `Unit` and `DeviceKind` types and `DEVICE_NAMES`; the per-scale unit tables live in `src/protocols/`.
2. **`src/scale.ts`** holds `Scale` and `toReading()`. `toReading` maps a `ParsedFrame` plus its receive times to a `Reading`. `Scale` is how users consume the scale:
   - Each `Scale` instance covers one connection.
   - `#close()` is idempotent. It ends every `readings()` iterator and fires `onDisconnect` once, whether the connection ended through a device drop, `disconnect()` or a failed `connect()`.
   - `readings()` starts buffering as soon as it's called, so callers create it before `connect()`.
   - Listener exceptions are caught and logged with `console.error`, so one bad callback doesn't affect the others.
3. **Transports** implement `ScaleTransport` (`src/transport.ts`). The library passes UUIDs around as full lowercase 128-bit strings.
   - `src/node/` contains `NobleTransport` on `@stoprocent/noble`. It converts UUIDs to noble's short, dashless form. `discovery.ts` (scan by name, power-state hints) is shared with the capture CLI.
   - `src/capacitor/` contains `CapacitorTransport` on `@capacitor-community/bluetooth-le`. It covers both native and Web Bluetooth (the demo page uses it).

Transport packages are optional peer dependencies. Only `src/node` and `src/capacitor` may import them.

TypeScript runs in strict mode with ESM and `NodeNext` resolution, so relative imports use `.js` extensions.

## Captures and tests

- Captures are grouped by device: `captures/huajun/*.jsonl` holds the frames this library decodes, with `NOTES.md` recording what the display showed. Each JSONL line is `{t, char, hex}`.
- `test/fixtures.ts` holds the distinct `FFB2` frames from each capture run, keyed by label. `test/parse.test.ts` checks every one against the expected decode.
- `test/helpers.ts` provides `bytes()` (hex string → `Uint8Array`) and `FakeTransport`, which replays frames after `subscribe()` and then disconnects.
- `test/capacitor.test.ts` replaces the BLE plugin with `vi.hoisted` + `vi.mock` and restores the fake's defaults in `beforeEach`.
- `test/docs.test.ts` uses a regex to collect exported names from the three entry points and fails if any name is missing from `docs/API.md`.

## Second device ("alpha")

The "alpha" scale (advertised `MY_SCALE`) is supported next to HUAJUN. It has the same service and `FFB2` characteristic but 20-byte frames (`AC 41 …`) instead of HUAJUN's 8 (`AC 05 …`).

- **Decoders:** `src/protocols/huajun.ts` and `src/protocols/alpha.ts` are pure decoders. `parseFrame(bytes, device = 'auto')` in `src/parse.ts` dispatches by frame length, or uses the decoder named by `device` (`'huajun' | 'alpha' | 'auto'`). `Scale` takes the same `device` option; both transports take `device` to pick which advertised name to look for (`DEVICE_NAMES`).
- **Alpha weight:** bytes 4-6 are milligrams whatever the display unit. `rawWeight` keeps them as sent, and `value` is converted into the displayed unit (ml assumes water; lb:oz has no value). Don't add new weight fields to `ParsedFrame`/`Reading`.
- **Captures:** `captures/alpha/*.jsonl` with `captures/alpha/NOTES.md` recording what the display showed. `captures/huajun/alpha1.jsonl` also contains alpha frames, despite being in the HUAJUN folder.
- **Tests:** `test/fixtures.alpha.ts` holds the distinct frames per alpha capture, and `test/parse.alpha.test.ts` also replays every `captures/alpha/*.jsonl` file, so a new capture must be added to the fixtures.
- **Same decoding rules:** the rules in `AGENTS.md` apply unchanged. Decode only fields that the captures confirm, and copy fixtures verbatim. Open questions are in `TODO.md`.

`task.md` is the original phased spec. It explains the design constraints but doesn't describe the current state.
