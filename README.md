# @mlewand/huajun-ble-scale

TypeScript library that reads live weight from a HUAJUN Bluetooth LE kitchen scale (advertised as `NSCALE`, 5000 g / 0.1 g). Works in Node (macOS) and in Capacitor/Web Bluetooth. Read-only: it only subscribes to notifications and never writes to the scale.

**Unofficial.** This project is not affiliated with or endorsed by HUAJUN. HUAJUN is a trademark of its owner; the name is used only to say which hardware the library works with.

The protocol was reverse-engineered from captures in `captures/`; only what those captures prove is decoded.

## Install

```
npm install @mlewand/huajun-ble-scale
npm install @stoprocent/noble                    # for the Node transport
npm install @capacitor-community/bluetooth-le    # for the Capacitor transport
```

Both transport packages are optional peer dependencies; the core has no dependencies.

## Usage

```ts
import { Scale } from '@mlewand/huajun-ble-scale';
import { NobleTransport } from '@mlewand/huajun-ble-scale/node';
// Capacitor / browser:
// import { CapacitorTransport } from '@mlewand/huajun-ble-scale/capacitor';

const scale = new Scale(new NobleTransport(), {
  onRejected: (data, rejection) => console.warn('ignored frame', rejection.reason),
});

const off = scale.onReading((r) => console.log(r.grams, r.stable)); // callback style; off() unsubscribes

const readings = scale.readings();             // listening starts here, so create it before connect()
scale.onDisconnect(() => console.log('disconnected'));
await scale.connect();
for await (const r of readings) console.log(r); // ends when the connection ends (or connect() fails)
```

Full reference: [docs/API.md](docs/API.md).

A `Reading` has `grams` (only when the display unit is g), `value`, `unit`, `stable`, `raw` (the undecoded frame) and `receivedAt`. Fields that aren't decoded are absent. Frames that fail validation (wrong length or header) are dropped and reported to `onRejected`.

`CapacitorTransport` calls `BleClient.initialize({ androidNeverForLocation: true })`. On Android 12+ declare `BLUETOOTH_SCAN` with `neverForLocation` in the manifest, as described in the plugin's README. On the web, `connect()` must run from a user gesture. Chrome's name filter does not match this scale, so pass `{ showAllDevices: true }` there.

## CLI

| Command | What it does |
|---|---|
| `npm run capture -- --label x [--duration 20] [--name NSCALE]` | Records raw frames from all notify characteristics to `captures/x.jsonl` and prints a run-length summary |
| `npm run watch` | Prints live readings through the public API |
| `npm run demo` | Vite demo page for desktop Chrome (Web Bluetooth): open `http://localhost:5173` |
| `npm test`, `npm run typecheck`, `npm run build` | Tests, typecheck, build to `dist/` |

On macOS the terminal app needs Bluetooth permission (System Settings > Privacy & Security > Bluetooth).

## Protocol

Service `0000ffb0-…`, notifications on `FFB2`, 8-byte frames, no writes needed. `FFB4` never sent data.

| Byte | Meaning | Status |
|---|---|---|
| 0 | Header `AC` | confirmed |
| 1–2 | `05 00`, constant | meaning unknown |
| 3–4 | Weight magnitude, big-endian; ÷10 for g, ÷100 for oz | confirmed for g, oz |
| 5, high nibble | Unit: 0 g, 1 ml, 2 lb:oz, 3 oz, 4 fl.oz | confirmed as codes |
| 5, bit 0 | Negative sign | confirmed for g |
| 6 | `CA` stable, `CE` changing | confirmed |
| 7 | Unknown; not a checksum of bytes 0–6 | unverified |

## Known unknowns

See [TODO.md](TODO.md): ml, fl.oz and lb:oz values aren't decoded, sign is only confirmed for grams, byte 7 and bytes 1–2 are unexplained, and there is no frame integrity check.

## License

MIT
