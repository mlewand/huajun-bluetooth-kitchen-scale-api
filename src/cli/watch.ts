/**
 * Print live weight readings and button presses via the public API.
 *
 *   npm run watch [-- --device huajun|alpha|auto] [--name NSCALE] [--resolution g=0.1,oz=0.05]
 *                 [--nutrition 100,2,3,4[,5,11,12,13,14,15,16]]
 *
 * --nutrition  calories,protein,fat,carbohydrate[,fiber,sodium,sugar,cholesterol,potassium,transFat,saturatedFat]:
 *              after the first reading, show them on the display with `Scale.setNutrition` (HUAJUN
 *              and Wozi keep them; alpha cycles the first four twice) and print the outcome. The
 *              fields after carbohydrate are optional; give as many as you need, in this order.
 */
import { parseArgs } from 'node:util';
import { DEFAULT_RESOLUTION, DEVICE_RESOLUTION, Scale, type DeviceKind, type Nutrition, type Resolution, type Unit } from '../index.js';
import { NobleTransport } from '../node/index.js';

const { values: args } = parseArgs({
  options: {
    name: { type: 'string' },
    device: { type: 'string', default: 'auto' },
    resolution: { type: 'string' },
    nutrition: { type: 'string' },
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
const NUTRITION_FIELDS = ['calories', 'protein', 'fat', 'carbohydrate', 'fiber', 'sodium', 'sugar', 'cholesterol', 'potassium', 'transFat', 'saturatedFat'] as const;
const nutritionValues = args.nutrition?.split(',').map(Number);
if (nutritionValues && (nutritionValues.length < 4 || nutritionValues.length > NUTRITION_FIELDS.length)) {
  console.error(`Error: --nutrition expects 4 to ${NUTRITION_FIELDS.length} numbers: ${NUTRITION_FIELDS.join(', ')}`);
  process.exit(1);
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

scale.onButton((p) => console.log(`[button] ${p.button}`));

// `--nutrition 100,2,3,4`: once the first reading has identified the scale, show them on its display.
if (nutritionValues) {
  const given = nutritionValues.map((value, i) => [NUTRITION_FIELDS[i]!, value] as const);
  const nutrition = Object.fromEntries(given) as unknown as Nutrition;
  const off = scale.onReading(() => {
    off();
    scale.setNutrition(nutrition).then(
      (sent) => console.error(sent
        ? `[nutrition] sent ${given.map(([name, value]) => `${name} ${value}`).join(', ')}`
        : '[nutrition] this scale cannot show nutrition; nothing sent'),
      (err) => console.error(`[nutrition] failed: ${err instanceof Error ? err.message : err}`),
    );
  });
}

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
