import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real scan needs an adapter; here only the names it's asked for matter.
const discovery = vi.hoisted(() => ({
  waitForPoweredOn: vi.fn(async () => {}),
  findByName: vi.fn(async (_names: readonly string[], _timeoutMs: number) => ({ connectAsync: async () => {} })),
}));
vi.mock('../src/node/discovery.js', () => discovery);

const { NobleTransport } = await import('../src/node/index.js');

describe('NobleTransport scan names', () => {
  beforeEach(() => discovery.findByName.mockClear());

  it.each([
    ['huajun', ['NSCALE', 'SCALE']],
    ['alpha', ['MY_SCALE']],
    ['auto', ['NSCALE', 'SCALE', 'MY_SCALE']],
  ] as const)('with device %s, scans for %j', async (device, names) => {
    await new NobleTransport({ device }).connect();
    expect(discovery.findByName).toHaveBeenCalledWith(names, 20_000);
  });

  it('scans for every known name by default', async () => {
    await new NobleTransport().connect();
    expect(discovery.findByName).toHaveBeenCalledWith(['NSCALE', 'SCALE', 'MY_SCALE'], 20_000);
  });

  it('an explicit name wins over device', async () => {
    await new NobleTransport({ device: 'alpha', name: 'OTHER', scanTimeoutMs: 5000 }).connect();
    expect(discovery.findByName).toHaveBeenCalledWith(['OTHER'], 5000);
  });
});
