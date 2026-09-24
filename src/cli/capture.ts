/**
 * Capture raw notifications from an NSCALE-style BLE kitchen scale.
 *
 * Connects by advertised name, subscribes to every notify/indicate
 * characteristic of service FFB0, records for a fixed time, then prints
 * a run-length summary (paste that back for decoding). Raw frames go to
 * captures/<label>.jsonl.
 *
 *   npm run capture -- --label run1 --duration 20
 */
import { parseArgs } from 'node:util';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findByName, waitForPoweredOn } from '../node/discovery.js';

const SERVICE_UUID = 'ffb0';

const { values: args } = parseArgs({
  options: {
    name: { type: 'string', default: 'NSCALE' },
    duration: { type: 'string', short: 'd', default: '20' },
    label: { type: 'string', short: 'l' },
    out: { type: 'string', default: 'captures' },
    'scan-timeout': { type: 'string', default: '20' },
  },
});

const durationMs = Number(args.duration) * 1000;
const scanTimeoutMs = Number(args['scan-timeout']) * 1000;
const label = args.label ?? new Date().toISOString().replace(/[:.]/g, '-');

type Frame = { t: number; char: string; hex: string };
type Run = { char: string; hex: string; from: number; to: number; count: number };

const toHex = (buf: Uint8Array) =>
  Array.from(buf, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

const log = (msg: string) => console.error(msg); // status on stderr, data on stdout

function collapse(frames: Frame[]): Run[] {
  const runs: Run[] = [];
  for (const f of frames) {
    const last = runs.at(-1);
    if (last && last.char === f.char && last.hex === f.hex) {
      last.count++;
      last.to = f.t;
    } else {
      runs.push({ char: f.char, hex: f.hex, from: f.t, to: f.t, count: 1 });
    }
  }
  return runs;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(2).padStart(6)}s`;

async function main() {
  await waitForPoweredOn(10_000);
  log(`Scanning for "${args.name}"...`);
  const peripheral = await findByName(args.name!, scanTimeoutMs);
  log(`Found ${args.name} (id ${peripheral.id}, RSSI ${peripheral.rssi}). Connecting...`);

  await peripheral.connectAsync();
  const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync([SERVICE_UUID], []);
  const notifying = characteristics.filter(
    (c) => c.properties.includes('notify') || c.properties.includes('indicate'),
  );
  if (notifying.length === 0) throw new Error(`No notify characteristics in service ${SERVICE_UUID}`);

  mkdirSync(args.out!, { recursive: true });
  const file = join(args.out!, `${label}.jsonl`);
  const stream = createWriteStream(file);
  const frames: Frame[] = [];
  const start = performance.now();

  for (const c of notifying) {
    const char = c.uuid.toUpperCase();
    c.on('data', (data: Buffer) => {
      const frame: Frame = { t: Math.round(performance.now() - start), char, hex: toHex(data) };
      frames.push(frame);
      stream.write(JSON.stringify(frame) + '\n');
      console.log(`${sec(frame.t)}  ${char}  ${frame.hex}`);
    });
    await c.subscribeAsync();
  }
  log(`Subscribed to ${notifying.map((c) => c.uuid.toUpperCase()).join(', ')}. Recording ${durationMs / 1000}s (Ctrl+C stops early)...`);

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, durationMs);
    const stop = () => { clearTimeout(timer); resolve(); };
    process.once('SIGINT', stop);
    peripheral.once('disconnect', () => { log('Scale disconnected.'); stop(); });
  });

  await peripheral.disconnectAsync().catch(() => {});
  await new Promise<void>((r) => stream.end(r));

  const elapsed = performance.now() - start;
  console.log(`\n=== ${label}: ${frames.length} frames in ${(elapsed / 1000).toFixed(1)}s (${(frames.length / (elapsed / 1000)).toFixed(1)}/s) ===`);
  for (const r of collapse(frames)) {
    console.log(`${sec(r.from)} ..${sec(r.to)}  x${String(r.count).padEnd(4)} ${r.char}  ${r.hex}`);
  }
  log(`\nRaw frames: ${file}`);
}

main()
  .then(() => process.exit(0)) // noble keeps handles open
  .catch((err) => { log(`Error: ${err instanceof Error ? err.message : err}`); process.exit(1); });
