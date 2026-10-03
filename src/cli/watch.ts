/**
 * Print live weight readings via the public API.
 *
 *   npm run watch [-- --device huajun|alpha|auto] [--name NSCALE]
 */
import { parseArgs } from 'node:util';
import { Scale, type DeviceKind } from '../index.js';
import { NobleTransport } from '../node/index.js';

const { values: args } = parseArgs({
  options: {
    name: { type: 'string' },
    device: { type: 'string', default: 'auto' },
    'scan-timeout': { type: 'string', default: '20' },
  },
});

if (args.device !== 'auto' && args.device !== 'huajun' && args.device !== 'alpha') {
  console.error('Error: --device must be huajun, alpha or auto');
  process.exit(1);
}
const device: DeviceKind | 'auto' = args.device;

const transport = new NobleTransport({
  device,
  scanTimeoutMs: Number(args['scan-timeout']) * 1000,
  ...(args.name !== undefined ? { name: args.name } : {}),
});
const scale = new Scale(transport, {
  device,
  onRejected: (data, rejection) => console.error(`Ignored frame (${rejection.reason}):`, Buffer.from(data).toString('hex')),
});

process.once('SIGINT', () => void scale.disconnect());

try {
  console.error(`Connecting to ${args.name ?? (device === 'auto' ? 'any supported scale' : `the ${device} scale`)}... (Ctrl+C to quit)`);
  const readings = scale.readings();
  await scale.connect();
  for await (const r of readings) {
    const value = r.value !== undefined ? r.value.toFixed(r.unit === 'oz' ? 2 : 1) : `raw ${Buffer.from(r.raw).toString('hex')}`;
    console.log(`${value} ${r.unit ?? '?'}${r.stable ? '  (stable)' : ''}`);
  }
  console.error('Disconnected.');
  process.exit(0); // noble keeps handles open
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
