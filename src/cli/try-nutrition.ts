/**
 * Experiment (HUAJUN and Wozi, never shipped): query the scale's model ID, which the library never
 * does, and write nutrition frames to its display counters, while logging everything the scale sends.
 *
 *   npm run try-nutrition [-- --values 100,2,3,4] [--fiber 5] [--extra 11,12,13,14,15,16] [--skip-extra]
 *                         [--gap 1] [--page 2] [--skip-query] [--wait 2] [--resend 6] [--duration 40]
 *                         [--label x] [--out captures/wozi] [--dry-run]
 *
 * --values  Calories (kcal), protein, fat and carbohydrate (g): `AD 01` fields 1-4. Every value is
 *           distinct by default so each display counter shows which field it reads.
 * --fiber   `AD 01` field 6.
 * --extra   Sodium, sugar, cholesterol, potassium, trans fat and saturated fat: the six fields of `AD 02`.
 * --skip-extra  Send `AD 01` only.
 * --gap     Seconds between `AD 01` and `AD 02`. Default 1, as the vendor app and the library do.
 *           0 sends them back to back, which hasn't been tried on a display.
 * --page    After the nutrition frames, also send the vendor app's page command
 *           `AC 05 FE 20 <page> 00 CC <sum>` (2 weighing, 1 totals). Not sent by default.
 * --skip-query  Don't send the model ID query first.
 * --wait    Seconds between the first weight frames (and the query) and the nutrition write.
 *           Default 2; the library writes as soon as it's asked, which can be right after connecting.
 * --resend  Resend the nutrition frames every N seconds (the vendor app resends every 6 s).
 *           0 (default) sends them once, to see whether the display keeps them.
 * --label   Also save the session to <out>/<label>.jsonl (default out: captures/huajun). Received
 *           frames use the capture format; frames this script wrote carry `"write": true`.
 * --dry-run Print the frames and exit without using Bluetooth.
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
    name: { type: 'string' },
    values: { type: 'string', default: '100,2,3,4' },
    fiber: { type: 'string', default: '5' },
    extra: { type: 'string', default: '11,12,13,14,15,16' },
    'skip-extra': { type: 'boolean', default: false },
    gap: { type: 'string', default: '1' },
    page: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
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
const EXTRA_FIELDS = ['sodium', 'sugar', 'cholesterol', 'potassium', 'transFat', 'saturatedFat'] as const;
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
const fiber = Number(args.fiber);
const extra = args.extra.split(',').map(Number);
if (extra.length !== EXTRA_FIELDS.length) fail(`--extra needs ${EXTRA_FIELDS.length} numbers: ${EXTRA_FIELDS.join(', ')}`);
const nutrition = {
  ...Object.fromEntries(FIELDS.map((name, i) => [name, numbers[i]])),
  fiber,
  ...(args['skip-extra'] ? {} : Object.fromEntries(EXTRA_FIELDS.map((name, i) => [name, extra[i]]))),
} as unknown as Nutrition;
let frames: Uint8Array[] = [];
try {
  frames = encodeNutrition(nutrition, 'huajun');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
const frame = frames[0]!;
const extraFrame = frames[1];
const page = args.page === undefined ? undefined : Number(args.page);
if (page !== undefined && !(Number.isInteger(page) && page >= 0 && page <= 0xff)) fail('--page needs a number from 0 to 255');
const pageFrame = page === undefined ? undefined : Uint8Array.from([0xac, 0x05, 0xfe, 0x20, page, 0x00, 0xcc, (0xfe + 0x20 + page + 0xcc) & 0xff]);
const gapMs = Number(args.gap) * 1000;
if (!(gapMs >= 0)) fail('--gap needs a number of seconds');
const label = [...FIELDS.map((name) => `${name} ${nutrition[name]}`), `fiber ${fiber}`].join(', ');
const extraLabel = EXTRA_FIELDS.map((name, i) => `${name} ${extra[i]}`).join(', ');

if (args['dry-run']) {
  console.log(`${toHex(frame)}  AD 01: ${label}`);
  if (extraFrame) console.log(`${toHex(extraFrame)}  AD 02: ${extraLabel}`);
  if (pageFrame) console.log(`${toHex(pageFrame)}  page ${page}`);
  process.exit(0);
}

const resendMs = Number(args.resend) * 1000;
const waitMs = Number(args.wait) * 1000;
if (!(waitMs >= 0)) fail('--wait needs a number of seconds');
const durationMs = Number(args.duration) * 1000;
if (!(resendMs >= 0) || !(durationMs > 0)) fail('--resend and --duration need numbers of seconds');

async function main() {
  await waitForPoweredOn(10_000);
  const names = args.name !== undefined ? [args.name] : DEVICE_NAMES.huajun;
  log(`Scanning for ${names.map((n) => `"${n}"`).join(' or ')}...`);
  const peripheral = await findByName(names, Number(args['scan-timeout']) * 1000);
  log(`Found ${peripheral.advertisement.localName} (id ${peripheral.id}). Connecting...`);
  const { manufacturerData, serviceUuids } = peripheral.advertisement;
  log(`Advertisement: manufacturer data ${manufacturerData ? toHex(manufacturerData) : 'none'}; services ${serviceUuids?.join(', ') || 'none'}`);
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

  const sendNutrition = async () => {
    await send(frame, `AD 01: ${label}`);
    if (extraFrame) {
      await sleep(gapMs);
      if (stopped) return;
      await send(extraFrame, `AD 02: ${extraLabel}`);
    }
    if (pageFrame && !stopped) await send(pageFrame, `page ${page}`);
  };

  // The vendor app waits about 3 s after the first weight frames before sending nutrition.
  if (!stopped) await sleep(waitMs);
  let timer: NodeJS.Timeout | undefined;
  if (!stopped) {
    await sendNutrition();
    if (resendMs > 0) timer = setInterval(() => void sendNutrition(), resendMs);
  }

  await done;
  clearInterval(timer);
  await peripheral.disconnectAsync().catch(() => {});
  if (stream) await new Promise<void>((r) => stream.end(r));

  log('');
  log(args['skip-query'] ? 'Model ID query skipped.' : did === undefined ? 'No model ID reply.' : `Model ID (DID): ${did} - ${MODELS[did] ?? 'not in the vendor app lists'}`);
  log(`Sent: ${label}${extraFrame ? `, ${extraLabel}` : ''}.`);
  log('Please note which display counter showed which number, and whether they stayed after a few seconds.');
  if (args.label) log(`Session saved to ${join(args.out!, `${args.label}.jsonl`)}`);
}

main()
  .then(() => process.exit(0)) // noble keeps handles open
  .catch((err) => fail(err instanceof Error ? err.message : String(err)));
