# @mlewand/huajun-ble-scale

TypeScript library that reads live weight from Bluetooth LE kitchen scales: HUAJUN (advertised as `NSCALE`, 5000 g / 0.1 g) and the "alpha" scale (advertised as `MY_SCALE`, 5000 g / 1 g). Works in Node (macOS) and in Capacitor/Web Bluetooth. Both scales use the same GATT service and characteristic, so by default (`device: 'auto'`) the library tells them apart by frame length; pass `device: 'huajun'` or `device: 'alpha'` to `Scale` and the transport to pin one. Read-only: it only subscribes to notifications and never writes to the scale.

**Unofficial.** This project is not affiliated with or endorsed by HUAJUN or any other scale maker. Brand names are trademarks of their owners and are used only to say which hardware the library works with.

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

A `Reading` has `device`, `grams` (only when the display unit is g), `value`, `unit`, `stable`, `raw` (the undecoded frame), `receivedAt` (`Date.now()`) and `receivedAtMonotonic` (a monotonic clock, for durations). Fields that aren't decoded are absent. Frames that fail validation (wrong length, header, frame type or checksum) are dropped and reported to `onRejected`.

`CapacitorTransport` calls `BleClient.initialize({ androidNeverForLocation: true })`. On Android 12+ declare `BLUETOOTH_SCAN` with `neverForLocation` in the manifest, as described in the plugin's README. On the web, `connect()` must run from a user gesture. Chrome's name filter does not match this scale, so pass `{ showAllDevices: true }` there. By default the picker is unfiltered (the plugin can filter by one name only); `{ device: 'huajun' }` or `{ device: 'alpha' }` filters by that scale's name. To reconnect without the picker, pass the first transport's `deviceId` to a new `CapacitorTransport({ deviceId })`; see [docs/API.md](docs/API.md#capacitortransport-capacitor).

## CLI

| Command | What it does |
|---|---|
| `npm run capture -- --label x [--duration 20] [--name <advertised name>]` | Records raw frames from all notify characteristics to `captures/x.jsonl` and prints a run-length summary |
| `npm run watch [-- --device huajun\|alpha\|auto] [--name <advertised name>]` | Prints live readings through the public API |
| `npm run demo` | Vite demo page for desktop Chrome (Web Bluetooth): open `http://localhost:5173` |
| `npm test`, `npm run typecheck`, `npm run build` | Tests, typecheck, build to `dist/` |

On macOS the terminal app needs Bluetooth permission (System Settings > Privacy & Security > Bluetooth).

## Protocol

Both scales: service `0000ffb0-…`, notifications on `FFB2`, no writes needed.

### HUAJUN (`NSCALE`)

8-byte frames. `FFB4` never sent data.

| Byte | Meaning | Status |
|---|---|---|
| 0 | Header `AC` | confirmed |
| 1–2 | `05 00`, constant | meaning unknown |
| 3–4 | Weight magnitude, big-endian; ÷10 for g, ÷100 for oz | confirmed for g, oz |
| 5, high nibble | Unit: 0 g, 1 ml, 2 lb:oz, 3 oz, 4 fl.oz | confirmed as codes |
| 5, bit 0 | Negative sign | confirmed for g |
| 6 | `CA` stable, `CE` changing | confirmed |
| 7 | Unknown; not a checksum of bytes 0–6 | unverified |

### alpha (`MY_SCALE`)

20-byte frames. The GATT service has only `FFB1` (write) and `FFB2` (notify).

| Byte | Meaning | Status |
|---|---|---|
| 0 | Header `AC` | confirmed |
| 1 | `41`, constant (frame type?) | meaning unknown |
| 2, bit 0 | Stable (1) or changing (0) | confirmed |
| 2, bit 7 | Negative sign | seen in one capture (tare, then item removed) |
| 2, bits 1–6 | Never set | unknown |
| 3, high nibble | Unit: 0 g, 1 ml, 2 lb:oz, 3 oz | confirmed as codes; fl.oz never captured |
| 3, low nibble | Always 0 | unknown |
| 4–6 | Weight magnitude, 24-bit big-endian, in milligrams whatever the display unit | confirmed against displays in g, oz, lb:oz and ml |
| 7–17 | Always 0 | unknown |
| 18 | Always `A6` | constant |
| 19 | Checksum: low byte of the sum of bytes 2–18 | confirmed on every captured frame |

The library converts the weight into the displayed unit (`ml` assumes water). After a value settles the scale sends about five stable frames and then stays silent until the weight changes. Tare is applied inside the scale: frames carry the net weight, and after tare with the item removed, the negated weight with the negative flag.

## Known unknowns

See [TODO.md](TODO.md): HUAJUN ml, fl.oz and lb:oz values and alpha lb:oz values aren't decoded, the HUAJUN sign is only confirmed for grams and the alpha sign comes from one capture, several bytes of both protocols are unexplained, and HUAJUN frames have no integrity check.

## License

MIT
