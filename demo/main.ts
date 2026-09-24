import { Scale } from '../src/index.js';
import { CapacitorTransport } from '../src/capacitor/index.js';

const $ = (id: string) => document.getElementById(id)!;

$('connect').addEventListener('click', async () => {
  // Called directly from the click so Web Bluetooth accepts the device chooser.
  // Chrome's name filter doesn't match this scale, so list all devices.
  const scale = new Scale(new CapacitorTransport({ showAllDevices: true }), {
    onRejected: (data, r) => console.warn('ignored frame', r.reason, data),
  });
  try {
    const loop = (async () => {
      for await (const r of scale.readings()) {
        $('weight').textContent = r.value !== undefined ? `${r.value.toFixed(r.unit === 'oz' ? 2 : 1)} ${r.unit}` : `? ${r.unit ?? ''}`;
        $('status').textContent = r.stable ? 'stable' : 'changing';
      }
    })();
    await scale.connect();
    $('status').textContent = 'Connected';
    await loop;
    $('status').textContent = 'Disconnected';
  } catch (err) {
    $('status').textContent = `Error: ${err instanceof Error ? err.message : err}`;
  }
});
