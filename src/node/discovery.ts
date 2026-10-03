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

/** Scan until a peripheral advertises any of `names` (case-insensitive). */
export function findByName(names: readonly string[], timeoutMs: number): Promise<Peripheral> {
  const wanted = names.map((n) => n.toLowerCase());
  const label = names.map((n) => `"${n}"`).join(' or ');
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      noble.removeListener('discover', onDiscover);
      void noble.stopScanningAsync();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`${label} not found within ${timeoutMs / 1000}s. Is another device (phone) still connected to it?`));
    }, timeoutMs);
    const onDiscover = (p: Peripheral) => {
      const found = p.advertisement.localName?.toLowerCase();
      if (found === undefined || !wanted.includes(found)) return;
      done();
      resolve(p);
    };
    noble.on('discover', onDiscover);
    noble.startScanningAsync([], false).catch(reject);
  });
}
