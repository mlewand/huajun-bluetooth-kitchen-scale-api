# Agent instructions

TypeScript library for a HUAJUN BLE kitchen scale. Core is platform-agnostic (`Uint8Array`/`DataView` only); BLE goes through `ScaleTransport`. The library reads from the scale and only decodes fields proven by captures in `captures/`. It writes to the scale only where the effect has been confirmed on the scale's display.

## Keep the docs in sync

Any change to the public API must update, in the same change:

- the TSDoc comments in `src/`,
- `docs/API.md` (the reference; every export of `src/index.ts`, `src/node/index.ts` and `src/capacitor/index.ts` must appear there),
- the README protocol table if decoding changed, and `TODO.md` if unknowns were resolved or added.

Public API means: exports of the three entry points, the shape of `Reading`/`ParsedFrame`/`Rejection`, `ScaleOptions`, transport options, the `ScaleTransport` contract, and lifecycle behaviour (what ends iterators, when callbacks fire).

## Adding a device

Follow [docs/NEW-DEVICE.md](docs/NEW-DEVICE.md): captures first, then a pure decoder in `src/protocols/`, then the table entries in `src/parse.ts`.

## Before finishing

Run `npm run typecheck && npm test`. `test/docs.test.ts` fails if an exported name is missing from `docs/API.md`.

## Rules

- Writes to the scale need the write-side equivalent of a capture: the effect confirmed on the scale's display. Only nutrition values (HUAJUN display counters; `AD 01` fields 1-4 are confirmed) are in scope; no tare, unit or other commands. Unconfirmed writes are experiments and belong in `src/cli/`, which is never shipped.
- Decode only what captures confirm; captured frames are fixtures copied verbatim.
- Don't add dependencies to the core.
