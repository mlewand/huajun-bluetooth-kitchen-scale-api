# Agent instructions

TypeScript library for a HUAJUN BLE kitchen scale. Core is platform-agnostic (`Uint8Array`/`DataView` only); BLE goes through `ScaleTransport`. The library is read-only toward the scale and only decodes fields proven by captures in `captures/`.

## Keep the docs in sync

Any change to the public API must update, in the same change:

- the TSDoc comments in `src/`,
- `docs/API.md` (the reference; every export of `src/index.ts`, `src/node/index.ts` and `src/capacitor/index.ts` must appear there),
- the README protocol table if decoding changed, and `TODO.md` if unknowns were resolved or added.

Public API means: exports of the three entry points, the shape of `Reading`/`ParsedFrame`/`Rejection`, `ScaleOptions`, transport options, the `ScaleTransport` contract, and lifecycle behaviour (what ends iterators, when callbacks fire).

## Before finishing

Run `npm run typecheck && npm test`. `test/docs.test.ts` fails if an exported name is missing from `docs/API.md`.

## Rules

- Never add writes to the scale. Decode only what captures confirm; captured frames are fixtures copied verbatim.
- Don't add dependencies to the core.
