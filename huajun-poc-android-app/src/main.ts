import { Capacitor } from "@capacitor/core";
import { Scale, type Reading } from "@mlewand/huajun-ble-scale";
import { CapacitorTransport } from "@mlewand/huajun-ble-scale/capacitor";

const $ = (id: string) => document.getElementById(id)!;

// On Android the picker is filtered to devices named NSCALE. Desktop Chrome's name filter doesn't match this
// scale, so there (and via the fallback button, if the filtered list is empty) list all devices.
const native = Capacitor.isNativePlatform();
if (native) $("connect-all").hidden = false;
$("connect").addEventListener("click", () => void connect(!native));
$("connect-all").addEventListener("click", () => void connect(true));
$("stop").addEventListener("click", () => void stop());

/** Backoff between reconnect attempts: 1 s, 2 s, 4 s, then every 5 s. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 5000];

let deviceId: string | undefined; // remembered after the first successful connect
let current: Scale | undefined; // the live connection, if any
let run = 0; // bumped by Connect and Stop, so an older reconnect loop quits

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

function status(text: string) {
  $("status").textContent = text;
}

function log(text: string) {
  const time = new Date().toLocaleTimeString();
  $("log").textContent = `${time}  ${text}\n${$("log").textContent ?? ""}`;
  console.log(text);
}

function show(r: Reading) {
  $("weight").textContent =
    r.value !== undefined
      ? `${r.value.toFixed(r.unit === "oz" ? 2 : 1)} ${r.unit}`
      : `? ${r.unit ?? ""}`;
  $("status").textContent = r.stable ? "stable" : "changing";
}

/**
 * One connection: connects, shows readings, and resolves when the connection ends.
 * Rejects if it couldn't connect at all.
 */
async function session(
  transport: CapacitorTransport,
  onConnected: () => void,
): Promise<void> {
  const scale = new Scale(transport, {
    onRejected: (data, r) => console.warn("ignored frame", r.reason, data),
  });
  current = scale;
  const readings = scale.readings(); // listen before connect()
  const loop = (async () => {
    for await (const r of readings) show(r);
  })();
  await scale.connect(); // on failure the loop ends by itself and this rejects
  onConnected();
  await loop; // ends when the scale disconnects (drop, switched off, or Stop)
}

async function connect(showAllDevices: boolean) {
  // Called directly from the click so Web Bluetooth accepts the device chooser.
  const myRun = ++run;
  await current?.disconnect().catch(() => {});
  const transport = new CapacitorTransport({ showAllDevices });
  try {
    await session(transport, () => {
      deviceId = transport.deviceId;
      status("Connected");
      log(`connected to ${deviceId} (picked)`);
    });
  } catch (err) {
    status(`Error: ${message(err)}`);
    log(`first connect failed: ${message(err)}`);
    return; // the first connect needs the picker, so no automatic retry
  }
  if (myRun === run) await reconnectLoop(myRun);
}

async function reconnectLoop(myRun: number) {
  let attempt = 0;
  while (myRun === run && deviceId !== undefined) {
    const delay =
      RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
    attempt++;
    status(
      `Disconnected. Reconnecting in ${delay / 1000} s (attempt ${attempt})…`,
    );
    log(`disconnected; attempt ${attempt} in ${delay} ms`);
    await sleep(delay);
    if (myRun !== run) return;

    status(`Reconnecting (attempt ${attempt})…`);
    const transport = new CapacitorTransport({ deviceId }); // known device: no picker
    const started = performance.now();
    try {
      await session(transport, () => {
        status("Connected");
        log(
          `reconnected to ${transport.deviceId} after ${attempt} attempt(s), ${Math.round(performance.now() - started)} ms`,
        );
        attempt = 0; // the next drop starts the backoff again
      });
    } catch (err) {
      const cause =
        err instanceof Error && err.cause !== undefined
          ? ` (cause: ${message(err.cause)})`
          : "";
      log(`attempt ${attempt} failed: ${message(err)}${cause}`);
    }
  }
}

async function stop() {
  run++; // makes any reconnect loop quit
  deviceId = undefined;
  await current?.disconnect().catch(() => {});
  current = undefined;
  status("Stopped. Connect to start again.");
  log("stopped by user");
}

// import { Capacitor } from '@capacitor/core';
// import { Scale } from '@mlewand/huajun-ble-scale';
// import { CapacitorTransport } from '@mlewand/huajun-ble-scale/capacitor';

// const $ = (id: string) => document.getElementById(id)!;

// // On Android the picker is filtered to devices named NSCALE. Desktop Chrome's name filter doesn't match this
// // scale, so there (and via the fallback button, if the filtered list is empty) list all devices.
// const native = Capacitor.isNativePlatform();
// if (native) $('connect-all').hidden = false;
// $('connect').addEventListener('click', () => connect(!native));
// $('connect-all').addEventListener('click', () => connect(true));

// async function connect(showAllDevices: boolean) {
//   // Called directly from the click so Web Bluetooth accepts the device chooser.
//   const scale = new Scale(new CapacitorTransport({ showAllDevices }), {
//     onRejected: (data, r) => console.warn('ignored frame', r.reason, data),
//   });
//   try {
//     const readings = scale.readings();
//     const loop = (async () => {
//       for await (const r of readings) {
//         $('weight').textContent = r.value !== undefined ? `${r.value.toFixed(r.unit === 'oz' ? 2 : 1)} ${r.unit}` : `? ${r.unit ?? ''}`;
//         $('status').textContent = r.stable ? 'stable' : 'changing';
//       }
//     })();
//     await scale.connect();
//     $('status').textContent = 'Connected';
//     await loop;
//     $('status').textContent = 'Disconnected';
//   } catch (err) {
//     $('status').textContent = `Error: ${err instanceof Error ? err.message : err}`;
//   }
// }
