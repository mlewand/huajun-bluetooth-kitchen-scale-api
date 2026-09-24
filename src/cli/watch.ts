/**
 * Print live weight readings via the public API.
 *
 *   npm run watch [-- --name NSCALE]
 */
import { parseArgs } from 'node:util';
import { Scale } from '../index.js';
import { NobleTransport } from '../node/index.js';

const { values: args } = parseArgs({
  options: {
    name: { type: 'string', default: 'NSCALE' },
    'scan-timeout': { type: 'string', default: '20' },
  },
});

const scale = new Scale(new NobleTransport({ name: args.name, scanTimeoutMs: Number(args['scan-timeout']) * 1000 }), {
  onRejected: (data, rejection) => console.error(`Ignored frame (${rejection.reason}):`, Buffer.from(data).toString('hex')),
});

process.once('SIGINT', () => void scale.disconnect());

try {
  console.error(`Connecting to "${args.name}"... (Ctrl+C to quit)`);
  await scale.connect();
  for await (const r of scale.readings()) {
    const value = r.value !== undefined ? r.value.toFixed(r.unit === 'oz' ? 2 : 1) : `raw ${Buffer.from(r.raw).toString('hex')}`;
    console.log(`${value} ${r.unit ?? '?'}${r.stable ? '  (stable)' : ''}`);
  }
  console.error('Disconnected.');
  process.exit(0); // noble keeps handles open
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
