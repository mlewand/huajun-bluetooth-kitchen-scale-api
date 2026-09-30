# API reference

Keep this file in sync with `src/` (enforced by `test/docs.test.ts`). For a quick start see the [README](../README.md).

## Entry points

| Import | Exports |
|---|---|
| `@mlewand/huajun-ble-scale` | `Scale`, `Reading`, `ScaleOptions`, `toReading`, `ReceiveTimes`, `parseFrame`, `ParsedFrame`, `ParseResult`, `Rejection`, `Unit`, `ScaleTransport`, `SERVICE_UUID`, `WEIGHT_CHARACTERISTIC` |
| `@mlewand/huajun-ble-scale/node` | `NobleTransport`, `NobleTransportOptions` |
| `@mlewand/huajun-ble-scale/capacitor` | `CapacitorTransport`, `CapacitorTransportOptions` |

The core has no dependencies and uses only `Uint8Array`/`DataView`.

## `Scale`

```ts
new Scale(transport: ScaleTransport, options?: ScaleOptions)
```

One instance covers one connection. To reconnect, create a new `Scale`. The scale is read-only: nothing is ever written to the device.

| Member | Description |
|---|---|
| `connect(): Promise<void>` | Connects the transport and subscribes to `WEIGHT_CHARACTERISTIC`. If it rejects, pending `readings()` iterators end and `onDisconnect` callbacks fire. |
| `disconnect(): Promise<void>` | Disconnects. Ends pending iterators and fires `onDisconnect` callbacks. |
| `onReading(cb): () => void` | Calls `cb(reading)` for every valid frame. Returns an unsubscribe function. A throwing callback is logged with `console.error` and doesn't affect other callbacks. |
| `onDisconnect(cb): () => void` | Fires once when the connection ends: device drop, `disconnect()`, or failed `connect()`. Returns an unsubscribe function. |
| `readings(): AsyncIterableIterator<Reading>` | Listening starts when it is called, so call it before `connect()`. The iterator ends when the connection ends; breaking out of a `for await` loop stops listening. Readings are queued without a limit, so consume them. |

`ScaleOptions`:

| Option | Description |
|---|---|
| `onRejected?(data, rejection)` | Called for frames that fail validation. Such frames are otherwise dropped silently. |
| `monotonicNow?(): number` | Monotonic clock for `receivedAtMonotonic`, in ms. Default `performance.now()`, available in browsers, Capacitor web views and Node. Mainly for tests. |

## `Reading`

| Field | Type | Present when |
|---|---|---|
| `grams` | `number` | The display unit is g. Signed (negative after tare). |
| `value` | `number` | The unit's scale is confirmed: g (÷10) and oz (÷100). Signed, in `unit`. |
| `unit` | `Unit` | Byte 5 holds a known unit code. `'g' \| 'ml' \| 'lb:oz' \| 'oz' \| 'fl.oz'` |
| `stable` | `boolean` | Byte 6 is `0xCA` (true) or `0xCE` (false). |
| `raw` | `Uint8Array` | Always. The undecoded 8-byte frame, including byte 7. |
| `receivedAt` | `number` | Always. `Date.now()` when received. Can jump when the device clock is adjusted. |
| `receivedAtMonotonic` | `number` | Always. Receive time on a monotonic clock, in ms (`performance.now()` by default). Never goes backwards, so use it for durations and ordering. Only differences between readings are meaningful. |

ml, fl.oz and lb:oz readings carry `unit`, `stable` and `raw` but no `value`; see [TODO.md](../TODO.md).

## `toReading(frame: ParsedFrame, times: ReceiveTimes): Reading`

The mapping `Scale` applies to every decoded frame, exported so stored raw bytes can be turned back into readings with the current version's decoding, for example to replay a recording:

```ts
const result = parseFrame(stored.raw);
if (result.ok) {
  const reading = toReading(result.frame, {
    receivedAt: stored.receivedAt,
    receivedAtMonotonic: stored.receivedAtMonotonic,
  });
}
```

`ReceiveTimes` is `{ receivedAt: number; receivedAtMonotonic: number }`, copied into the reading as is. For the same bytes and times, `toReading` returns exactly what `Scale` delivers.

## `parseFrame(bytes: Uint8Array): ParseResult`

Pure decoder for one notification. Returns `{ ok: true, frame: ParsedFrame }` or `{ ok: false, rejection: Rejection }`.

`Rejection` reasons: `{ reason: 'bad-length', length }` (not 8 bytes) and `{ reason: 'bad-header', header }` (byte 0 isn't `0xAC`). There is no checksum validation because byte 7 has no known formula.

`ParsedFrame` has `rawWeight` (unsigned integer from bytes 3-4), `negative`, `raw`, and the optional `unit`, `value` and `stable` described above. `Unit` is the display-unit union.

## Constants

- `SERVICE_UUID`: `0000ffb0-0000-1000-8000-00805f9b34fb`
- `WEIGHT_CHARACTERISTIC`: `0000ffb2-0000-1000-8000-00805f9b34fb`

## `ScaleTransport`

The interface `Scale` needs, so you can supply your own BLE layer:

```ts
interface ScaleTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void>;
  onDisconnect(cb: () => void): void;
}
```

- `connect()` resolves once connected and ready for `subscribe()`.
- `subscribe()` receives a full lowercase 128-bit UUID, and must deliver each notification as its own `Uint8Array`.
- `onDisconnect()` is called by `Scale` after `connect()` resolves. It must fire when the device drops and when `disconnect()` is called.

## `NobleTransport` (`/node`)

Uses `@stoprocent/noble` (optional peer dependency). Scans by advertised name, then connects.

`NobleTransportOptions`: `name` (default `NSCALE`), `scanTimeoutMs` (default 20000). Errors are thrown from `connect()` with readable messages: Bluetooth off, no adapter, scale not found. On macOS the terminal app needs Bluetooth permission (System Settings > Privacy & Security > Bluetooth), otherwise `connect()` rejects with an `unauthorized` message.

## `CapacitorTransport` (`/capacitor`)

Uses `@capacitor-community/bluetooth-le` (optional peer dependency). `connect()` initializes the plugin with `androidNeverForLocation: true`, then either shows the device picker or, with `deviceId`, connects to a known device without it.

`CapacitorTransportOptions`:

| Option | Description |
|---|---|
| `name` | Advertised name the picker filters by. Default `NSCALE`. |
| `showAllDevices` | Show every nearby device in the picker. Chrome's Web Bluetooth name filter does not match this scale, so set it on the web. |
| `deviceId` | Connect to this device without the picker. `name` and `showAllDevices` are then ignored. `undefined` shows the picker, so `{ deviceId: first.deviceId }` is fine before any device was picked. If the device can't be connected, `connect()` rejects with an error saying so, with the plugin's error as `cause`. It never falls back to the picker, which needs a user gesture. |

`deviceId` (read-only property): the connected device's ID, whether it was picked or given. It is set once `connect()` has found the device. To reconnect after a drop without asking the user again, create a new transport and a new `Scale` with it:

```ts
const first = new CapacitorTransport({ showAllDevices: true });
await new Scale(first).connect(); // shows the picker
// ...after the scale disconnects:
const again = new CapacitorTransport({ deviceId: first.deviceId });
await new Scale(again).connect(); // no picker
```

The plugin can only connect to devices it knows about:
- **In the same page session as the first pick** (the reconnect-after-drop case), it already does.
- **For a device from an earlier session**, the transport first calls the plugin's `getDevices([deviceId])`, best-effort: a failure or an empty result is ignored, and the connect attempt decides.
  - On iOS that registers the device.
  - On the web it uses `navigator.bluetooth.getDevices()`, which Chrome still keeps behind a flag, so on the web reconnecting by ID reliably works only within the page session of the first pick.
  - On Android the ID is enough.

- **Web:** HTTPS or `localhost` only. When it shows the picker, `connect()` must be called from a user gesture.
- **Android 12+:** declare `BLUETOOTH_SCAN` with `neverForLocation` in the manifest, per the plugin's README.
