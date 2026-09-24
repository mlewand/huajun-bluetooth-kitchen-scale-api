import noble from '@stoprocent/noble';
import type { Peripheral } from '@stoprocent/noble';

export { noble };

export async function waitForPoweredOn(timeoutMs = 10_000): Promise<void> {
  const hint: Record<string, string> = {
    unauthorized: 'Bluetooth access denied. On macOS grant your terminal app permission in System Settings > Privacy & Security > Bluetooth, then restart the terminal.',
    poweredOff: 'Bluetooth is turned off.',
    unsupported: 'No Bluetooth LE adapter available.',
  };
  const fail = () => new Error(hint[noble.state] ?? `Bluetooth not ready (state: ${noble.state}).`);
  if (noble.state === 'unauthorized') throw fail();
  await noble.waitForPoweredOnAsync(timeoutMs).catch(() => { throw fail(); });
}

export function findByName(name: string, timeoutMs: number): Promise<Peripheral> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      noble.removeListener('discover', onDiscover);
      void noble.stopScanningAsync();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`"${name}" not found within ${timeoutMs / 1000}s. Is another device (phone) still connected to it?`));
    }, timeoutMs);
    const onDiscover = (p: Peripheral) => {
      if (p.advertisement.localName?.toLowerCase() !== name.toLowerCase()) return;
      done();
      resolve(p);
    };
    noble.on('discover', onDiscover);
    noble.startScanningAsync([], false).catch(reject);
  });
}
