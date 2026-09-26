# Task: TypeScript library for reading a HUAJUN BLE kitchen scale

Build a small TypeScript library that connects to a Bluetooth LE kitchen scale and emits live weight readings. It must run on macOS through Node (for development and a companion CLI) and later inside a Capacitor app on Android. The deliverable is an API, and the CLI is a thin consumer of it.

The work is split into phases with **checkpoints**. At each checkpoint, stop and wait for my input; do not continue past it on guesses.

## Project setup

- The git repository already exists and is the current working directory: `@mlewand/huajun-ble-scale`.
- Package name: `@mlewand/huajun-ble-scale`. A single npm package with subpath exports: the root (core), `/node` (Node transport), `/capacitor` (Capacitor transport). Transport dependencies are optional peer dependencies, so the core stays dependency-free.
- License: MIT.
- Tooling: TypeScript (strict), ESM, `vitest` for tests, `tsx` for running scripts. Node 22 LTS.

## Device facts

- Brand: HUAJUN. Max 5000 g, d = 0.1 g. Buttons: Total, UNIT, +Plate, ON/TARE.
- Advertised Bluetooth name: `NSCALE`.
- The weight is **not** carried in BLE advertisements; it comes over a GATT connection.
- GATT, as seen in a BLE scanner app on Android:

  | UUID | Properties |
  |---|---|
  | Service `0000ffb0-0000-1000-8000-00805f9b34fb` | primary |
  | `FFB1` | write, write without response |
  | `FFB2` | notify (carries the weight reading) |
  | `FFB3` | write without response |
  | `FFB4` | notify (purpose unknown) |

- Notifications on `FFB2` start arriving as soon as notifications are enabled; no write is needed.

Nothing about the payload format is known. Working it out is part of this task.

## Hard constraints

- **Read-only toward the scale.** The library subscribes to notifications and never writes to `FFB1`/`FFB3`. If data shows the stream stops without a keepalive or command, report it at a checkpoint instead of adding writes.
- **The core is platform-agnostic.** Use `Uint8Array`/`DataView` only; no `Buffer`, no Node or DOM APIs. All BLE access goes through a small transport interface, roughly:

  ```ts
  interface ScaleTransport {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void>;
    onDisconnect(cb: () => void): void;
  }
  ```

  Adjust the shape if the platforms need it, but keep it minimal.
- **Decode only what captures prove.** A field is decoded only when captured frames at known values confirm it. Unconfirmed bytes stay exposed as raw data, not guessed and labelled.
- **Captured frames are test fixtures**, copied verbatim into tests.
- **Existing work is a hypothesis, not a source of truth.** You may search for existing projects or protocol write-ups for this scale or similar devices, but anything found must be verified against my captures before it is used. Do not copy code from projects whose license is incompatible with MIT.

## Phase 1: capture tool

Build `npm run capture` (Node, macOS):

- Scan for the advertised name (default `NSCALE`, overridable), with a scan timeout and a clear error message when the scale isn't found.
- Connect, discover service `FFB0`, subscribe to **every** notify/indicate characteristic in it (`FFB2` and `FFB4`), and tag each frame with its characteristic.
- Record for a fixed duration (default 20 s, `--duration`), stoppable with Ctrl+C. Stop cleanly if the scale disconnects.
- Print each frame live: elapsed time, characteristic, spaced uppercase hex.
- Write raw frames to `captures/<label>.jsonl` (`--label`, defaulting to a timestamp).
- At the end, print a **run-length summary**: consecutive identical frames collapse into one line with a count and time range. This summary is what I'll hand back to you.
- Node BLE library: evaluate the maintained noble forks (e.g. `@abandonware/noble`, `@stoprocent/noble`) and pick whichever installs and works on current macOS with Node 22. Mention the macOS Bluetooth permission requirement for the terminal app in the error message for `unauthorized`.
- Create `captures/NOTES.md` as a template where I record, per label, what I did and what the display showed.

Typecheck and make sure it builds. You can't test against hardware; I will.

### ⏸ Checkpoint 1: I run captures

I will run the tool three times with three different known weights. Each run starts with an empty scale, then I place the item, let it settle, and remove it before the end. I'll fill in `captures/NOTES.md` and commit the `.jsonl` files. I may add optional extra runs (UNIT pressed to switch units, TARE with an item on, negative weight after tare). Wait for me.

## Phase 2: decode

Using the captures and `NOTES.md`:

1. Identify the frame layout: which bytes carry the weight (endianness, scale factor, sign handling), and whether there is a header, frame type, stability flag, unit field, or checksum. Also check whether `FFB4` carries anything.
2. If the frames appear to contain a checksum, find its formula by testing candidates systematically against **every** captured frame. If none fits all frames, do not block the rest of the work; mark the checksum as unverified and note it.
3. Write a pure parser, `parseFrame(bytes: Uint8Array)`, returning a typed result or a typed rejection (e.g. unexpected header, bad length, checksum mismatch). Unit-test it with every distinct captured frame.

### ⏸ Checkpoint 2: review the decoding

Present a table with each byte position, what it means, and the evidence (which frames/values prove it). List what is still unknown. If a field needs another capture to confirm, tell me exactly what to capture. Wait for my approval before building the API on top.

## Phase 3: library API and Node transport

- A `Scale` class (name it as you see fit) built on a transport. It emits parsed readings and exposes both an event/callback style and an async iterator, e.g. `scale.onReading(cb)` returning an unsubscribe function, plus `for await (const r of scale.readings())`.
- The reading type contains at least: weight in grams (as a number), the stable flag if decoded, the unit if decoded, the raw frame, and a receive timestamp. Anything not yet decoded is absent, not guessed.
- Decide and document what happens with frames that fail validation (skip them, optionally surface them via a debug callback).
- Node transport implementation using the chosen noble package.
- Add `npm run watch` to the CLI: prints live weight readings through the public API, not through raw BLE calls.
- Tests for the `Scale` class with a fake transport that replays captured fixtures.

## Phase 4: Capacitor transport

- Implement the transport on `@capacitor-community/bluetooth-le`. Use full lowercase 128-bit UUIDs there. Handle initialization and Android 12+ permissions per the plugin's docs (`androidNeverForLocation`).
- The plugin's web implementation uses Web Bluetooth, so add a minimal demo page (Vite is fine) that I can open in desktop Chrome on macOS to verify this transport before trying Android. Web Bluetooth requires the service in `optionalServices` (or in the scan filter) and a user gesture to start the scan.
- I will test on an Android device myself later; note anything I should check there.

## Phase 5: README

Brief README: supported device, install, API usage for Node and Capacitor, CLI commands, the decoded protocol table, and known unknowns.

## Working style

- Keep dependencies minimal and the code small; this is a single-device library, not a framework.
- After each phase, summarise what was built, what is verified vs. unverified, and what you need from me.
