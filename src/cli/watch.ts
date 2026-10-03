/**
 * Print live weight readings via the public API.
 *
 *   npm run watch [-- --device huajun|alpha|auto] [--name NSCALE] [--resolution g=0.1,oz=0.05]
 */
import { parseArgs } from 'node:util';
import { DEFAULT_RESOLUTION, DEVICE_RESOLUTION, Scale, type DeviceKind, type Resolution, type Unit } from '../index.js';
import { NobleTransport } from '../node/index.js';

const { values: args } = parseArgs({
  options: {
    name: { type: 'string' },
    device: { type: 'string', default: 'auto' },
    resolution: { type: 'string' },
    'scan-timeout': { type: 'string', default: '20' },
  },
});

if (args.device !== 'auto' && args.device !== 'huajun' && args.device !== 'alpha') {
  console.error('Error: --device must be huajun, alpha or auto');
  process.exit(1);
}
const device: DeviceKind | 'auto' = args.device;

// `--resolution g=0.1,oz=0.05` overrides the display resolution per unit (see ScaleOptions.resolution).
const resolution: Resolution = {};
for (const pair of args.resolution?.split(',') ?? []) {
  const [unit, step] = pair.split('=');
  if (!unit || !(unit in DEFAULT_RESOLUTION) || !(Number(step) > 0)) {
    console.error(`Error: --resolution expects unit=step pairs such as g=0.1 (units: ${Object.keys(DEFAULT_RESOLUTION).join(', ')})`);
    process.exit(1);
  }
  resolution[unit as Unit] = Number(step);
}
const decimals = (r: { device: DeviceKind; unit: Unit }) => {
  const step = resolution[r.unit] ?? DEVICE_RESOLUTION[r.device][r.unit] ?? DEFAULT_RESOLUTION[r.unit] ?? 1;
  return (String(step).split('.')[1] ?? '').length;
};

const transport = new NobleTransport({
  device,
  scanTimeoutMs: Number(args['scan-timeout']) * 1000,
  ...(args.name !== undefined ? { name: args.name } : {}),
});
const scale = new Scale(transport, {
  device,
  resolution,
  onRejected: (data, rejection) => console.error(`Ignored frame (${rejection.reason}):`, Buffer.from(data).toString('hex')),
});

process.once('SIGINT', () => void scale.disconnect());

try {
  console.error(`Connecting to ${args.name ?? (device === 'auto' ? 'any supported scale' : `the ${device} scale`)}... (Ctrl+C to quit)`);
  const readings = scale.readings();
  await scale.connect();
  for await (const r of readings) {
    const value = r.value !== undefined ? r.value.toFixed(r.unit ? decimals({ device: r.device, unit: r.unit }) : 1) : `raw ${Buffer.from(r.raw).toString('hex')}`;
    console.log(`${value} ${r.unit ?? '?'}${r.stable ? '  (stable)' : ''}`);
  }
  console.error('Disconnected.');
  process.exit(0); // noble keeps handles open
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
