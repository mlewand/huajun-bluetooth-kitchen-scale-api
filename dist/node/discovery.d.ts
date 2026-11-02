import noble from '@stoprocent/noble';
import type { Peripheral } from '@stoprocent/noble';
export { noble };
export declare function waitForPoweredOn(timeoutMs?: number): Promise<void>;
/** Scan until a peripheral advertises any of `names` (case-insensitive). */
export declare function findByName(names: readonly string[], timeoutMs: number): Promise<Peripheral>;
