/**
 * Experiment (HUAJUN only, never shipped): query the scale's model ID and write one nutrition
 * frame (`encodeNutrition`) to its display counters, while logging everything the scale sends.
 *
 *   npm run try-nutrition [-- --values 100,2,3,4] [--skip-query] [--wait 2] [--resend 6] [--duration 40] [--label x]
 *
 * --values  Calories (kcal), protein, fat and carbohydrate (g). Every value is distinct by default
 *           so each display counter shows which field it reads.
 * --skip-query  Don't send the model ID query first (the library never sends it).
 * --wait    Seconds between the first weight frames (and the query) and the nutrition write.
 *           Default 2; the library writes as soon as it's asked, which can be right after connecting.
 * --resend  Resend the nutrition frame every N seconds (the vendor app resends every 6 s).
 *           0 (default) sends it once, to see whether the display keeps it.
 * --label   Also save the session to captures/huajun/<label>.jsonl. Received frames use the
 *           capture format; frames this script wrote carry `"write": true`.
 *
 * The model ID query `AC 05 FE 1D 00 00 CC E7` and its reply `AC 05 FE 1D hi lo ?? ??` come from a
 * decompiled vendor app (SmartApple 3.3.0). The library itself never sends the query.
 */
import { parseArgs } from 'node:util';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { Characteristic } from '@stoprocent/noble';
import { DEVICE_NAMES, encodeNutrition, parseButton, parseFrame, type Nutrition } from '../parse.js';
import { findByName, waitForPoweredOn } from '../node/discovery.js';

const { values: args } = parseArgs({
  options: {
    name: { type: 'string', default: DEVICE_NAMES.huajun },
    values: { type: 'string', default: '100,2,3,4' },
    resend: { type: 'string', default: '0' },
    'skip-query': { type: 'boolean', default: false },
    wait: { type: 'string', default: '2' },
    duration: { type: 'string', default: '40' },
    label: { type: 'string' },
    out: { type: 'string', default: 'captures/huajun' },
    'scan-timeout': { type: 'string', default: '20' },
  },
});

const FIELDS = ['calories', 'protein', 'fat', 'carbohydrate'] as const;
const DID_QUERY = [0xac, 0x05, 0xfe, 0x1d, 0x00, 0x00, 0xcc, 0xe7];
/** Model IDs the vendor app knows, from its class names and nutrition lists. */
const MODELS: Record<number, string> = {
  20: 'Nk2596 (current-food nutrition)',
  21: 'Nk965bt (current-food and plate-total nutrition)',
  25: 'plate-total nutrition model', 26: 'plate-total nutrition model', 27: 'plate-total nutrition model',
  90: 'plate-total nutrition model', 91: 'plate-total nutrition model',
};

const log = (msg: string) => console.error(msg);
const fail = (msg: string): never => { log(`Error: ${msg}`); process.exit(1); };
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** `ffb1`, `0000ffb1-…` or `0000ffb100001000…` → `ffb1`. */
const shortUuid = (uuid: string) => {
  const hex = uuid.toLowerCase().replaceAll('-', '');
  return hex.length === 32 ? hex.slice(4, 8) : hex.slice(-4);
};

const numbers = args.values.split(',').map(Number);
if (numbers.length !== FIELDS.length) fail(`--values needs ${FIELDS.length} numbers: ${FIELDS.join(', ')}`);
const nutrition = Object.fromEntries(FIELDS.map((name, i) => [name, numbers[i]])) as unknown as Nutrition;
let frame: Uint8Array;
try {
  frame = encodeNutrition(nutrition);
} catch (err) {
  fail(`--values: ${err instanceof Error ? err.message : err}`);
}
const resendMs = Number(args.resend) * 1000;
const waitMs = Number(args.wait) * 1000;
if (!(waitMs >= 0)) fail('--wait needs a number of seconds');
const durationMs = Number(args.duration) * 1000;
if (!(resendMs >= 0) || !(durationMs > 0)) fail('--resend and --duration need numbers of seconds');

async function main() {
  await waitForPoweredOn(10_000);
  log(`Scanning for "${args.name}"...`);
  const peripheral = await findByName([args.name], Number(args['scan-timeout']) * 1000);
  log(`Found ${peripheral.advertisement.localName} (id ${peripheral.id}). Connecting...`);
  await peripheral.connectAsync();

  // Discover everything, as NobleTransport does, and print it: the library takes the first FFB1
  // of any service, this script the one in FFB0.
  const { services } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
  for (const s of services) {
    log(`Service ${s.uuid}: ${(s.characteristics ?? []).map((c) => `${c.uuid} [${c.properties.join(', ')}]`).join('; ') || 'no characteristics'}`);
  }
  const characteristics = services.find((s) => shortUuid(s.uuid) === 'ffb0')?.characteristics ?? fail('service ffb0 not found');
  const all = services.flatMap((s) => s.characteristics ?? []);
  for (const uuid of ['ffb1', 'ffb2']) {
    const matches = all.filter((c) => shortUuid(c.uuid) === uuid).length;
    if (matches > 1) log(`Note: ${matches} characteristics match ${uuid}; the library would take the first one listed above.`);
  }
  const find = (uuid: string) => characteristics.find((c) => shortUuid(c.uuid) === uuid) ?? fail(`characteristic ${uuid} not found`);
  const notify: Characteristic = find('ffb2');
  const write: Characteristic = find('ffb1');
  const withoutResponse = write.properties.includes('writeWithoutResponse');
  log(`FFB1 properties: ${write.properties.join(', ')}. Writing ${withoutResponse ? 'without' : 'with'} response.`);

  let stream: WriteStream | undefined;
  if (args.label) {
    mkdirSync(args.out!, { recursive: true });
    stream = createWriteStream(join(args.out!, `${args.label}.jsonl`));
  }
  const start = performance.now();
  const now = () => Math.round(performance.now() - start);
  const sec = (t: number) => `${(t / 1000).toFixed(2).padStart(6)}s`;

  let weightFrames = 0;
  let did: number | undefined;
  notify.on('data', (data: Buffer) => {
    const bytes = new Uint8Array(data);
    const t = now();
    stream?.write(JSON.stringify({ t, char: 'FFB2', hex: toHex(bytes) }) + '\n');
    let note = '';
    const parsed = parseFrame(bytes, 'huajun');
    if (parsed.ok) {
      weightFrames++;
      note = `${parsed.frame.value ?? '?'} ${parsed.frame.unit ?? '?'}${parsed.frame.stable ? ' (stable)' : ''}`;
    } else if (bytes.length === 8 && bytes[2] === 0xfe && bytes[3] === 0x1d) {
      did = (bytes[4]! << 8) | bytes[5]!;
      note = `<-- model ID (DID) ${did}: ${MODELS[did] ?? 'not in the vendor app lists'}`;
    } else {
      note = parseButton(bytes) ? `button ${parseButton(bytes)}` : `rejected: ${parsed.rejection.reason}`;
    }
    console.log(`${sec(t)}  FFB2  ${toHex(bytes)}  ${note}`);
  });
  await notify.subscribeAsync();

  const send = async (bytes: Uint8Array | number[], what: string) => {
    const frame = Uint8Array.from(bytes);
    const t = now();
    stream?.write(JSON.stringify({ t, char: 'FFB1', hex: toHex(frame), write: true }) + '\n');
    console.log(`${sec(t)}  FFB1  ${toHex(frame)}  --> ${what}`);
    await write.writeAsync(Buffer.from(frame), withoutResponse);
  };

  let stopped = false;
  const done = new Promise<void>((resolve) => {
    const stop = () => { stopped = true; resolve(); };
    setTimeout(stop, durationMs);
    process.once('SIGINT', stop);
    peripheral.once('disconnect', () => { log('Scale disconnected.'); stop(); });
  });

  log(`Listening for ${durationMs / 1000}s (Ctrl+C stops early). Waiting for weight frames...`);
  for (let i = 0; i < 50 && weightFrames < 3 && !stopped; i++) await sleep(100);

  // The vendor app sends the query on each of the first four weight frames; stop once it answers.
  for (let i = 0; i < 4 && did === undefined && !stopped && !args['skip-query']; i++) {
    await send(DID_QUERY, 'model ID query');
    await sleep(500);
  }

  // The vendor app waits about 3 s after the first weight frames before sending nutrition.
  if (!stopped) await sleep(waitMs);
  const label = FIELDS.map((name) => `${name} ${nutrition[name]}`).join(', ');
  let timer: NodeJS.Timeout | undefined;
  if (!stopped) {
    await send(frame, `nutrition: ${label}`);
    if (resendMs > 0) timer = setInterval(() => void send(frame, 'nutrition (resend)'), resendMs);
  }

  await done;
  clearInterval(timer);
  await peripheral.disconnectAsync().catch(() => {});
  if (stream) await new Promise<void>((r) => stream.end(r));

  log('');
  log(args['skip-query'] ? 'Model ID query skipped.' : did === undefined ? 'No model ID reply.' : `Model ID (DID): ${did} - ${MODELS[did] ?? 'not in the vendor app lists'}`);
  log(`Sent: ${label}.`);
  log('Please note which display counter showed which number, and whether they stayed after a few seconds.');
  if (args.label) log(`Session saved to ${join(args.out!, `${args.label}.jsonl`)}`);
}

main()
  .then(() => process.exit(0)) // noble keeps handles open
  .catch((err) => fail(err instanceof Error ? err.message : String(err)));
