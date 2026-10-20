/**
 * Experiment (alpha / MY_SCALE only, never shipped): find out what the scale needs before it shows
 * nutrition values written to it, while logging everything it sends.
 *
 *   npm run try-alpha-nutrition [-- --sessions plain,handshake] [--label x] [--self-test]
 *
 * Session `plain` (no handshake): connect, subscribe, and as soon as a stable weight of 5 g or more
 * arrives, write the nutrition command (`0xD5`). If the display didn't show it, write again once at
 * least 5 s have passed since connecting, to separate "needs a handshake" from "written too early".
 *
 * Session `handshake` (what FitDays does): connect, subscribe, send user info / time (`0xD0`) with the
 * advertised device byte, wait for the scale's device info (`0xA0`), send `0xD0` again with the device
 * byte from `0xA0`, acknowledge with `0xD1`, then write nutrition on a stable weight.
 *
 * After each nutrition write the script asks whether the display cycled the values; the answers end
 * up in the log. Frame layouts are from `protocols/kitchen-general-40.md` of the FitDays analysis
 * project; `--self-test` checks the encoder against frames captured from FitDays and exits.
 *
 * --sessions  Comma-separated sessions to run, in order. Default `plain,handshake`.
 * --label     Also save every frame to captures/alpha/<label>.jsonl (writes carry `"write": true`).
 */
import { parseArgs } from 'node:util';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Characteristic, Peripheral } from '@stoprocent/noble';
import { DEVICE_NAMES } from '../parse.js';
import { findByName, waitForPoweredOn } from '../node/discovery.js';

const { values: args } = parseArgs({
  options: {
    name: { type: 'string', default: DEVICE_NAMES.alpha },
    sessions: { type: 'string', default: 'plain,handshake' },
    label: { type: 'string' },
    out: { type: 'string', default: 'captures/alpha' },
    'scan-timeout': { type: 'string', default: '20' },
    'self-test': { type: 'boolean', default: false },
  },
});

/** Weight that counts as "something is on the scale", in mg. */
const MIN_LOAD_MG = 5000;
const STABLE_TIMEOUT_MS = 60_000;
const A0_TIMEOUT_MS = 3000;
/** Nutrition type codes the scale listed in `supportDataTypes`: kcal, fat, carbs, protein. */
const TYPE_NAMES: Record<number, string> = {
  0: 'kcal', 1: 'fat', 2: 'carbs', 3: 'cholesterol', 4: 'sodium', 5: 'protein',
  7: 'calcium', 8: 'iron', 9: 'potassium', 11: 'sugar', 13: 'fibre', 14: 'saturated fat',
};

interface Nutrition { kcal: number; protein: number; fat: number; carbs: number }
/** Distinct, easy-to-spot values per attempt, so the log can say which write the display showed. */
const ATTEMPT_VALUES: Nutrition[] = [
  { kcal: 111, protein: 1.2, fat: 3.4, carbs: 5.6 },
  { kcal: 222, protein: 2.3, fat: 4.5, carbs: 6.7 },
  { kcal: 333, protein: 3.4, fat: 5.6, carbs: 7.8 },
  { kcal: 444, protein: 4.5, fat: 6.7, carbs: 8.9 },
];

const log = (msg: string) => console.error(msg);
const fail = (msg: string): never => { log(`Error: ${msg}`); process.exit(1); };
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shortUuid = (uuid: string) => {
  const hex = uuid.toLowerCase().replaceAll('-', '');
  return hex.length === 32 ? hex.slice(4, 8) : hex.slice(-4);
};

/** Sum of bytes 2..18, low byte: the checksum in byte 19 of every frame, both directions. */
const sum8 = (b: Uint8Array) => {
  let s = 0;
  for (let i = 2; i <= 18; i++) s = (s + b[i]!) & 0xff;
  return s;
};

/** A 20-byte frame: `AC dev <16 bytes> type sum8`. */
function frame(dev: number, type: number, body: number[]): Uint8Array {
  if (body.length > 16) throw new RangeError('frame body longer than 16 bytes');
  const b = new Uint8Array(20);
  b[0] = 0xac;
  b[1] = dev;
  b.set(body, 2);
  b[18] = type;
  b[19] = sum8(b);
  return b;
}

const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const u24 = (v: number) => [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

/**
 * `0xD0` user info / time sync. Device byte `0x40`: time, UTC offset, unit 0. Any other device byte:
 * time, UTC offset, userId, cur_rni, max_rni, progress (all 0 here except userId 1).
 */
function encodeD0(dev: number, date = new Date()): Uint8Array {
  const offsetMin = -date.getTimezoneOffset();
  const utc = Math.abs(offsetMin) | (offsetMin < 0 ? 0x8000 : 0);
  const head = [...u32(Math.floor(date.getTime() / 1000)), ...u16(utc)];
  return frame(dev, 0xd0, dev === 0x40 ? [...head, 0] : [...head, ...u32(1), ...u16(0), ...u16(0), ...u16(0)]);
}

/** `0xD1` app reply acknowledging a scale frame of `type` with status 0. */
const encodeD1 = (dev: number, type: number) => frame(dev, 0xd1, [type, 0]);

/**
 * `0xD5` food nutrition, multi-frame: payload = foodId u32, count u8, then per fact {type u8, value u24}.
 * kcal (type 0) is an integer; the others are float32(value) × 10, truncated, as the app's native
 * encoder does. Each frame carries `[frame count][index]` and 14 payload bytes.
 */
function encodeD5(dev: number, foodId: number, facts: Array<[type: number, value: number]>): Uint8Array[] {
  const payload = [...u32(foodId), facts.length];
  for (const [type, value] of facts) {
    const raw = type === 0 ? Math.trunc(value) : Math.trunc(Math.fround(Math.fround(value) * 10));
    payload.push(type, ...u24(raw));
  }
  const count = Math.ceil(payload.length / 14);
  return Array.from({ length: count }, (_, i) => frame(dev, 0xd5, [count, i, ...payload.slice(i * 14, i * 14 + 14)]));
}

/** Facts in the order FitDays sent them (ascending type: kcal, fat, carbs, protein). */
const nutritionFacts = (n: Nutrition): Array<[number, number]> => [[0, n.kcal], [1, n.fat], [2, n.carbs], [5, n.protein]];
const describe = (n: Nutrition) => `kcal ${n.kcal}, protein ${n.protein} g, fat ${n.fat} g, carbs ${n.carbs} g`;

/** Check the encoders against frames FitDays sent to this scale (HCI snoop log, 2026-10-20). */
function selfTest(): void {
  const expect = (what: string, got: Uint8Array[], want: string[]) => {
    const ok = got.length === want.length && got.every((f, i) => toHex(f) === want[i]);
    log(`${ok ? 'OK  ' : 'FAIL'} ${what}`);
    if (!ok) { log(`  got:  ${got.map(toHex).join(' | ')}`); log(`  want: ${want.join(' | ')}`); process.exitCode = 1; }
  };
  expect('D5 from FitDays (1106 kcal, fat 86.1, carbs 0, protein 82.9)',
    encodeD5(0x41, 10121158, [[0, 1106], [1, 86.1], [2, 0], [5, 82.9]]),
    ['AC 41 02 00 00 9A 6F C6 04 00 00 04 52 01 00 03 5D 02 D5 63', 'AC 41 02 01 00 00 00 05 00 03 3D 00 00 00 00 00 00 00 D5 1D']);
  expect('D1 ack of A0', [encodeD1(0x41, 0xa0)], ['AC 41 A0 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 D1 71']);
  const t = new Date(1792487458 * 1000);
  const d0 = encodeD0(0x40, t);
  // Byte 6-7 depend on the local time zone; FitDays was at UTC+2 (0x0078).
  log(`info D0 for dev 0x40 at the captured time, local zone: ${toHex(d0)} (FitDays at UTC+2: AC 40 6A D7 30 22 00 78 00 ... D0 DB)`);
}

/** Decoded summary of a scale → app frame, for the log. */
function decodeIncoming(b: Uint8Array): string {
  if (b.length !== 20 || b[0] !== 0xac) return `not a 20-byte AC frame (${b.length} bytes)`;
  const sumOk = sum8(b) === b[19];
  const type = b[18]!;
  const tag = `dev 0x${b[1]!.toString(16)} type 0x${type.toString(16).toUpperCase()}${sumOk ? '' : ' BAD-SUM'}`;
  if (type === 0xa6) {
    const status = b[2]!;
    const word = ((b[3]! << 24) | (b[4]! << 16) | (b[5]! << 8) | b[6]!) >>> 0;
    const mg = word & 0x0fffffff;
    const flags = [status & 0x3f ? `state ${status & 0x3f}${(status & 0x3f) === 1 ? ' (stable)' : ''}` : 'state 0 (changing)'];
    if (status & 0x40) flags.push('tare');
    if (status & 0x80) flags.push('negative');
    return `${tag} weight ${(mg / 1000).toFixed(1)} g, unit code ${word >>> 28}, ${flags.join(', ')}`;
  }
  if (type === 0xa0) {
    const fun = (b[2]! << 16) | (b[3]! << 8) | b[4]!;
    const entries = ((fun >> 17) & 3) + 2;
    const off = 5 + 3 * entries;
    let extra = '';
    if (b[1]! > 0x40) {
      const types = (b[off + 1]! << 8) | b[off + 2]!;
      const funcs = (b[off + 3]! << 8) | b[off + 4]!;
      const bits = (v: number) => Array.from({ length: 16 }, (_, i) => i).filter((i) => (v >> i) & 1);
      extra = `, supportDataTypes [${bits(types).map((i) => `${i} ${TYPE_NAMES[i] ?? '?'}`).join(', ')}], functions [${bits(funcs).join(', ')}]`;
    }
    return `${tag} DEVICE INFO funInfo 0x${fun.toString(16).padStart(6, '0')}${extra}, battery byte ${b[17]}`;
  }
  if (type === 0xa1) return `${tag} COMMAND ACK, body ${toHex(b.subarray(2, 18))}`;
  return `${tag} body ${toHex(b.subarray(2, 18))}`;
}

const rl = createInterface({ input: process.stdin, output: process.stderr });
/** Ask the user something; the answer is logged to stdout so it's part of the pasted log. */
async function ask(question: string): Promise<string> {
  const answer = (await rl.question(`\n>>> ${question} `)).trim();
  console.log(`         USER  ${question} -> ${answer || '(no answer)'}`);
  return answer;
}
const yes = (a: string) => /^y/i.test(a);

let stream: WriteStream | undefined;

async function runSession(session: string, attemptsLeft: Nutrition[]): Promise<void> {
  console.log(`\n===== Session "${session}" =====`);
  log(`Scanning for "${args.name}"... (make sure FitDays is closed: only one app can connect)`);
  const peripheral: Peripheral = await findByName([args.name], Number(args['scan-timeout']) * 1000);
  const mfr = peripheral.advertisement.manufacturerData;
  const advDev = mfr && (mfr[0] === 0xac || mfr[0] === 0xca) && mfr.length > 1 ? mfr[1]! : 0x40;
  console.log(`         found ${peripheral.advertisement.localName} id ${peripheral.id} rssi ${peripheral.rssi}, manufacturer data ${mfr ? toHex(mfr) : 'none'}`);

  const start = performance.now();
  const t = () => Math.round(performance.now() - start);
  const sec = (ms: number) => `${(ms / 1000).toFixed(2).padStart(6)}s`;
  await peripheral.connectAsync();
  console.log(`${sec(t())}  connected`);
  let connected = true;
  peripheral.once('disconnect', () => { connected = false; console.log(`${sec(t())}  DISCONNECTED by the scale`); });

  const { services } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
  for (const s of services) {
    console.log(`         service ${s.uuid}: ${(s.characteristics ?? []).map((c) => `${shortUuid(c.uuid)} [${c.properties.join(', ')}]`).join('; ') || 'no characteristics'}`);
  }
  const characteristics = services.find((s) => shortUuid(s.uuid) === 'ffb0')?.characteristics ?? fail('service ffb0 not found');
  const find = (uuid: string) => characteristics.find((c) => shortUuid(c.uuid) === uuid) ?? fail(`characteristic ${uuid} not found`);
  const notify: Characteristic = find('ffb2');
  const write: Characteristic = find('ffb1');
  const withoutResponse = write.properties.includes('writeWithoutResponse');
  console.log(`         writing FFB1 ${withoutResponse ? 'without' : 'with'} response`);

  // Latest weight frame and waiters for frame types.
  let latest: { mg: number; stable: boolean } | undefined;
  let scaleDev: number | undefined;
  const waiters = new Set<(b: Uint8Array) => void>();
  notify.on('data', (data: Buffer) => {
    const b = new Uint8Array(data);
    const at = t();
    stream?.write(JSON.stringify({ session, t: at, char: 'FFB2', hex: toHex(b) }) + '\n');
    console.log(`${sec(at)}  FFB2  ${toHex(b)}  ${decodeIncoming(b)}`);
    if (b.length === 20 && b[0] === 0xac && sum8(b) === b[19]) {
      scaleDev ??= b[1];
      if (b[18] === 0xa6) {
        const mg = (((b[3]! << 24) | (b[4]! << 16) | (b[5]! << 8) | b[6]!) >>> 0) & 0x0fffffff;
        latest = { mg, stable: (b[2]! & 0x3f) === 1 };
      }
    }
    for (const w of waiters) w(b);
  });
  await notify.subscribeAsync();
  console.log(`${sec(t())}  subscribed to FFB2`);

  const send = async (frames: Uint8Array[], what: string) => {
    for (const f of frames) {
      const at = t();
      stream?.write(JSON.stringify({ session, t: at, char: 'FFB1', hex: toHex(f), write: true }) + '\n');
      console.log(`${sec(at)}  FFB1  ${toHex(f)}  --> ${what}`);
      await write.writeAsync(Buffer.from(f), withoutResponse);
    }
  };
  const waitForType = (type: number, ms: number) => new Promise<Uint8Array | undefined>((resolve) => {
    const timer = setTimeout(() => { waiters.delete(w); resolve(undefined); }, ms);
    const w = (b: Uint8Array) => { if (b[18] === type) { clearTimeout(timer); waiters.delete(w); resolve(b); } };
    waiters.add(w);
  });
  const waitForStableLoad = async () => {
    const until = performance.now() + STABLE_TIMEOUT_MS;
    let hinted = false;
    while (connected && performance.now() < until) {
      if (latest?.stable && latest.mg >= MIN_LOAD_MG) return true;
      if (!hinted && performance.now() - start > 3000) { log('    ...waiting for a stable weight of at least 5 g: put the item on the scale.'); hinted = true; }
      await sleep(50);
    }
    return false;
  };

  if (session === 'handshake') {
    await send([encodeD0(advDev)], `user info / time (D0), advertised device byte 0x${advDev.toString(16)}`);
    let a0 = await waitForType(0xa0, A0_TIMEOUT_MS);
    if (!a0 && connected) {
      console.log(`${sec(t())}  no A0 within ${A0_TIMEOUT_MS / 1000}s, re-sending D0 once`);
      await send([encodeD0(advDev)], 'user info / time (D0), retry');
      a0 = await waitForType(0xa0, A0_TIMEOUT_MS);
    }
    if (a0) {
      const dev = a0[1]!;
      if (dev !== advDev) await send([encodeD0(dev)], `user info / time (D0) again with the device byte from A0, 0x${dev.toString(16)}`);
      await send([encodeD1(dev, 0xa0)], 'acknowledge A0 (D1)');
    } else {
      console.log(`${sec(t())}  NO A0 device info received`);
    }
  }

  const attempt = async (what: string) => {
    const values = attemptsLeft.shift() ?? ATTEMPT_VALUES[0]!;
    if (!(await waitForStableLoad())) { console.log(`${sec(t())}  no stable load within ${STABLE_TIMEOUT_MS / 1000}s or disconnected; skipping`); return false; }
    const dev = scaleDev ?? advDev;
    console.log(`${sec(t())}  stable ${(latest!.mg / 1000).toFixed(1)} g -> sending nutrition (${what}): ${describe(values)}`);
    await send(encodeD5(dev, 1, nutritionFacts(values)), `nutrition D5: ${describe(values)}`);
    await sleep(500);
    const answer = await ask(`Watch the scale's display now. Did it cycle the nutrition labels and show values (e.g. ${values.kcal} kcal)? [y/n]`);
    if (yes(answer)) await ask('Optional: which numbers did it show, and in which label order? (Enter to skip)');
    return yes(answer);
  };

  if (session === 'plain') {
    const shown = await attempt('right after the first stable weight, no handshake');
    if (!shown && connected) {
      const wait = 5000 - t();
      if (wait > 0) { console.log(`${sec(t())}  waiting until 5 s after connecting before retrying`); await sleep(wait); }
      await attempt('at least 5 s after connecting, no handshake');
    }
  } else {
    await attempt('after the FitDays-style handshake');
  }

  await sleep(1000);
  await peripheral.disconnectAsync().catch(() => {});
  console.log(`${sec(t())}  session "${session}" done`);
}

async function main() {
  if (args['self-test']) { selfTest(); return; }
  const sessions = args.sessions.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = sessions.filter((s) => s !== 'plain' && s !== 'handshake');
  if (bad.length || !sessions.length) fail(`--sessions takes plain and/or handshake, got "${args.sessions}"`);
  if (args.label) {
    mkdirSync(args.out!, { recursive: true });
    stream = createWriteStream(join(args.out!, `${args.label}.jsonl`));
  }
  selfTest();
  if (process.exitCode) fail('encoder self-test failed; not talking to the scale');

  await waitForPoweredOn(10_000);
  const attemptsLeft = [...ATTEMPT_VALUES];
  for (const [i, session] of sessions.entries()) {
    if (i > 0) await ask('Next session. Take the item off the scale, wait until it shows 0, put the item back, then press Enter.');
    else await ask('Close FitDays on your phone, wake the scale and put an item (100 g or more) on it. Press Enter when ready.');
    await runSession(session, attemptsLeft);
    await sleep(2000);
  }
  if (stream) await new Promise<void>((r) => stream!.end(r));
  log('\nDone. Please paste everything above (from "===== Session") back into the chat.');
  if (args.label) log(`Frames also saved to ${join(args.out!, `${args.label}.jsonl`)}`);
}

main()
  .then(() => { rl.close(); process.exit(process.exitCode ?? 0); }) // noble keeps handles open
  .catch((err) => fail(err instanceof Error ? err.message : String(err)));
