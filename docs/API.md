# API reference

Keep this file in sync with `src/` (enforced by `test/docs.test.ts`). For a quick start see the [README](../README.md); to support another scale see [Adding a device driver](NEW-DEVICE.md).

## Entry points

| Import | Exports |
|---|---|
| `@mlewand/huajun-ble-scale` | `Scale`, `Reading`, `ButtonPress`, `ScaleOptions`, `toReading`, `ReceiveTimes`, `parseFrame`, `ParsedFrame`, `ParseResult`, `Rejection`, `parseButton`, `Button`, `encodeNutrition`, `Nutrition`, `Unit`, `DeviceKind`, `DEVICE_NAMES`, `Resolution`, `DEVICE_RESOLUTION`, `DEFAULT_RESOLUTION`, `ScaleTransport`, `SERVICE_UUID`, `WEIGHT_CHARACTERISTIC`, `WRITE_CHARACTERISTIC` |
| `@mlewand/huajun-ble-scale/node` | `NobleTransport`, `NobleTransportOptions` |
| `@mlewand/huajun-ble-scale/capacitor` | `CapacitorTransport`, `CapacitorTransportOptions` |

The core has no dependencies and uses only `Uint8Array`/`DataView`.

Two scales are supported, identified by `DeviceKind`: `'huajun'` (advertised as `NSCALE`, 8-byte frames) and `'alpha'` (advertised as `MY_SCALE`, 20-byte frames). They share the service and characteristic UUIDs, so the frames are told apart by length.

## `Scale`

```ts
new Scale(transport: ScaleTransport, options?: ScaleOptions)
```

One instance covers one connection. To reconnect, create a new `Scale`. The only thing ever written to the device is the nutrition frame of `setNutrition()`, and only to a HUAJUN scale.

| Member | Description |
|---|---|
| `connect(): Promise<void>` | Connects the transport and subscribes to `WEIGHT_CHARACTERISTIC`. If it rejects, pending `readings()` iterators end and `onDisconnect` callbacks fire. |
| `disconnect(): Promise<void>` | Disconnects. Ends pending iterators and fires `onDisconnect` callbacks. |
| `onReading(cb): () => void` | Calls `cb(reading)` for every valid frame. Returns an unsubscribe function. A throwing callback is logged with `console.error` and doesn't affect other callbacks. |
| `onButton(cb): () => void` | Calls `cb(press)` with a [`ButtonPress`](#buttonpress) for every button press the scale reports (HUAJUN `+Plate` and `Total`; alpha reports none). Returns an unsubscribe function. A throwing callback is logged with `console.error` and doesn't affect other callbacks. |
| `setNutrition(nutrition): Promise<void>` | HUAJUN only. Sets the display's nutrition counters to a [`Nutrition`](#encodenutritionnutrition-nutrition-device-devicekind-uint8array) (calories, protein, fat, carbohydrate), rounded to 0.1. They stay on the display until the connection ends, so call it again after reconnecting, and to update them. Rejects if not connected, if the transport has no `write`, with a `RangeError` for out-of-range values, and unless the scale is known to be HUAJUN: pass `device: 'huajun'`, or with `'auto'` wait for the first reading or button press. Nothing is written when it rejects. |
| `onDisconnect(cb): () => void` | Fires once when the connection ends: device drop, `disconnect()`, or failed `connect()`. Returns an unsubscribe function. |
| `readings(): AsyncIterableIterator<Reading>` | Listening starts when it is called, so call it before `connect()`. The iterator ends when the connection ends; breaking out of a `for await` loop stops listening. Readings are queued without a limit, so consume them. |

`ScaleOptions`:

| Option | Description |
|---|---|
| `device?: DeviceKind \| 'auto'` | Which scale to decode. `'auto'` (default) decodes whichever scale's frames arrive, told apart by length. An explicit device rejects the other scale's frames as `bad-length`. |
| `resolution?: Resolution` | Resolution `Reading.value` is rounded to, per unit, e.g. `{ g: 0.1 }` or `{ g: 0.001 }`. Merged over the device's display resolution (below), so only the units given change. Every step must be finite and > 0, otherwise the constructor throws a `RangeError`. |
| `onRejected?(data, rejection)` | Called for frames that fail validation and aren't a known button press. Such frames are otherwise dropped silently. |
| `monotonicNow?(): number` | Monotonic clock for `receivedAtMonotonic`, in ms. Default `performance.now()`, available in browsers, Capacitor web views and Node. Mainly for tests. |

## `Reading`

| Field | Type | Present when |
|---|---|---|
| `device` | `DeviceKind` | Always. Which scale's decoder produced the reading. |
| `grams` | `number` | The display unit is g. Signed (negative after tare). Rounded like `value`. |
| `value` | `number` | The unit's scale is confirmed (see below). Signed, in `unit`, rounded to the display resolution (see below). |
| `unit` | `Unit` | The frame holds a known unit code. `'g' \| 'ml' \| 'lb:oz' \| 'oz' \| 'fl.oz'` |
| `stable` | `boolean` | HUAJUN: byte 6 is `0xCA` (true) or `0xCE` (false). alpha: byte 2 bit 0, unless bits 1-6 of byte 2 are set. |
| `raw` | `Uint8Array` | Always. The undecoded frame (8 bytes for HUAJUN, 20 for alpha), including the bytes that are not understood. |
| `receivedAt` | `number` | Always. `Date.now()` when received. Can jump when the device clock is adjusted. |
| `receivedAtMonotonic` | `number` | Always. Receive time on a monotonic clock, in ms (`performance.now()` by default). Never goes backwards, so use it for durations and ordering. Only differences between readings are meaningful. |

`value` is decoded for HUAJUN in g and ml (÷10) and in oz and fl.oz (÷100), and for alpha in g, oz and ml. lb:oz readings on both scales carry `unit`, `stable` and `raw` but no `value`; see [TODO.md](../TODO.md).

On alpha the scale always sends the weight in milligrams and the library converts it into the displayed unit: `value` is grams for g, grams ÷ 28.349523125 for oz, and grams for ml, which assumes water (1 g = 1 ml; the scale can't know the liquid). `grams` stays tied to the display unit, so in oz or ml mode it is absent; the exact weight in milligrams is `ParsedFrame.rawWeight` (via `parseFrame(reading.raw)`).

### Resolution

`value` and `grams` are rounded to what the scale's display shows, so they match what the user sees. Rounding is to the nearest step, ties away from zero, applied to the magnitude (so negative weights round like positive ones). The steps are per display unit:

| Device (`DEVICE_RESOLUTION`) | g | ml | oz | fl.oz |
|---|---|---|---|---|
| `huajun` | 0.1 | 0.1 | 0.01 | 0.01 |
| `alpha` | 1 | 1 | 0.1 | no `value` |

`DEFAULT_RESOLUTION` (`{ g: 1, ml: 1, oz: 0.1, 'fl.oz': 0.1 }`) covers any unit a device's entry doesn't list, so a new device only needs an entry where it differs. `Resolution` is `Partial<Record<Unit, number>>`, a step size in that unit. Pass `ScaleOptions.resolution` (or the third argument of `toReading`) to ask for more, for example `{ g: 0.1 }`. The alpha scale sends milligrams, so down to `{ g: 0.001 }` is real data. `ParsedFrame.value` from `parseFrame` and `rawWeight` are never rounded.

After a value settles, the alpha scale sends about five frames with `stable: true` and then stays silent until the weight changes, so a quiet stream doesn't mean a lost connection.

## `ButtonPress`

What `Scale.onButton` delivers. Only HUAJUN buttons are decoded; alpha captures only pressed TARE, which sent no frame of its own.

| Field | Type | Description |
|---|---|---|
| `device` | `DeviceKind` | Always `'huajun'` for now. |
| `button` | `Button` | `'plate'` for `+Plate`, `'total'` for `Total`. |
| `raw` | `Uint8Array` | The undecoded frame. |
| `receivedAt` | `number` | `Date.now()` when received, as in `Reading`. |
| `receivedAtMonotonic` | `number` | Receive time on the monotonic clock, as in `Reading`. |

`UNIT` and `TARE` don't send button frames. A `UNIT` press shows up as the unit change in the next readings, and `TARE` as the weight going to zero.

## `toReading(frame: ParsedFrame, times: ReceiveTimes, resolution?: Resolution): Reading`

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

`ReceiveTimes` is `{ receivedAt: number; receivedAtMonotonic: number }`, copied into the reading as is. `resolution` is `ScaleOptions.resolution` and throws `RangeError` for the same invalid steps. For the same bytes, times and resolution, `toReading` returns exactly what `Scale` delivers.

## `parseFrame(bytes: Uint8Array, device?: DeviceKind | 'auto'): ParseResult`

Pure decoder for one notification. Returns `{ ok: true, frame: ParsedFrame }` or `{ ok: false, rejection: Rejection }`.

`device` defaults to `'auto'`: an 8-byte frame is decoded as HUAJUN, a 20-byte frame as alpha, any other length is rejected. With an explicit device only that decoder runs, so the other scale's frames are rejected as `bad-length`.

`Rejection` reasons:

- `{ reason: 'bad-length', length }`: not 8 bytes (HUAJUN) or 20 bytes (alpha).
- `{ reason: 'bad-header', header }`: byte 0 isn't `0xAC`.
- `{ reason: 'unknown-frame-type', type }`: byte 1 isn't the frame type, `0x05` for HUAJUN or `0x41` for alpha.
- `{ reason: 'control-frame', type }` (HUAJUN): byte 2 is `0xFE`, so the frame is a control frame rather than a weight. `type` is byte 3. Button presses are control frames: `parseButton` decodes them, and `Scale` delivers them to `onButton` instead of `onRejected`. Control frames that aren't a known button still reach `onRejected`.
- `{ reason: 'bad-checksum', expected, actual }` (alpha): the low byte of the sum of bytes 2-18 doesn't equal byte 19.

HUAJUN frames get no checksum validation because byte 7 has no known formula.

`ParsedFrame` has `device`, `rawWeight` (unsigned magnitude as sent: HUAJUN bytes 3-4, alpha the 24 bits of bytes 4-6 in milligrams), `negative`, `raw`, and the optional `unit`, `value` and `stable` described above. `Unit` is the display-unit union.

`DeviceKind` is `'huajun' | 'alpha'`.

## `parseButton(bytes: Uint8Array, device?: DeviceKind | 'auto'): Button | undefined`

Pure decoder for button presses, the counterpart of `parseFrame` (which rejects these frames as `control-frame`). Returns the `Button` (`'plate' | 'total'`), or `undefined` for any other frame. `device` works as in `parseFrame`; `'alpha'` always gives `undefined`.

HUAJUN button frames are `AC 05 FE 1E xx 00 00 ??`: `xx` is `03` for `+Plate` and `04` for `Total`. Other codes, and non-zero bytes 5-6, were never captured, so they give `undefined`. Byte 7 isn't checked.

## `encodeNutrition(nutrition: Nutrition, device?: DeviceKind): Uint8Array`

Pure encoder for the frame `setNutrition` writes to `WRITE_CHARACTERISTIC`, for use with your own BLE layer. `device` defaults to `'huajun'`, the only scale it supports; any other device throws.

`Nutrition` is `{ calories, protein, fat, carbohydrate }`, in kcal and grams, as the HUAJUN display shows them. All four are required. Each must be a finite number from 0 to 1677721.5, otherwise it throws a `RangeError`.

The frame is `AD 01` followed by six 24-bit big-endian values of round(value × 10), with no checksum: calories, protein, fat, carbohydrate, energy from fat, fiber. The vendor app fills the last two with fat × 9 and fiber. The HUAJUN display doesn't show them, so the library sends fat × 9 (capped at the maximum) and 0.

## Constants

- `DEVICE_NAMES`: advertised name per device, `{ huajun: 'NSCALE', alpha: 'MY_SCALE' }`
- `DEVICE_RESOLUTION`, `DEFAULT_RESOLUTION`, `Resolution`: the display resolution per device and unit that `Reading.value` is rounded to; see [Resolution](#resolution)
- `SERVICE_UUID`: `0000ffb0-0000-1000-8000-00805f9b34fb`
- `WEIGHT_CHARACTERISTIC`: `0000ffb2-0000-1000-8000-00805f9b34fb`
- `WRITE_CHARACTERISTIC`: `0000ffb1-0000-1000-8000-00805f9b34fb`, where `setNutrition` writes

## `ScaleTransport`

The interface `Scale` needs, so you can supply your own BLE layer:

```ts
interface ScaleTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void>;
  onDisconnect(cb: () => void): void;
  write?(characteristic: string, data: Uint8Array): Promise<void>;
}
```

- `connect()` resolves once connected and ready for `subscribe()`.
- `subscribe()` receives a full lowercase 128-bit UUID, and must deliver each notification as its own `Uint8Array`.
- `onDisconnect()` is called by `Scale` after `connect()` resolves. It must fire when the device drops and when `disconnect()` is called.
- `write()` is optional and only used by `setNutrition`. It receives a full lowercase 128-bit UUID and should write without response where the characteristic supports it. Both built-in transports implement it.

## `NobleTransport` (`/node`)

Uses `@stoprocent/noble` (optional peer dependency). Scans by advertised name, then connects.

`NobleTransportOptions`: `name` (advertised name to scan for; wins over `device`), `device` (`DeviceKind | 'auto'`; an explicit device scans for that scale's name from `DEVICE_NAMES`, `'auto'`, the default, takes the first scale found under either name), `scanTimeoutMs` (default 20000). Errors are thrown from `connect()` with readable messages: Bluetooth off, no adapter, scale not found. On macOS the terminal app needs Bluetooth permission (System Settings > Privacy & Security > Bluetooth), otherwise `connect()` rejects with an `unauthorized` message.

## `CapacitorTransport` (`/capacitor`)

Uses `@capacitor-community/bluetooth-le` (optional peer dependency). `connect()` initializes the plugin with `androidNeverForLocation: true`, then either shows the device picker or, with `deviceId`, connects to a known device without it.

`CapacitorTransportOptions`:

| Option | Description |
|---|---|
| `name` | Advertised name the picker filters by. Wins over `device`. |
| `device` | `DeviceKind \| 'auto'`. An explicit device filters the picker by that scale's name from `DEVICE_NAMES` (`device: 'huajun'` is the old `NSCALE` filter). `'auto'`, the default, shows every nearby device, because the plugin filters by a single name and neither scale is known to advertise its service. |
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
