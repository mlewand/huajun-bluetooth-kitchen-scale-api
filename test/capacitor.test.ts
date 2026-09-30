import { beforeEach, describe, expect, it, vi } from 'vitest';

// The plugin talks to native code or Web Bluetooth; here it's a fake that records calls.
const ble = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  requestDevice: vi.fn(async () => ({ deviceId: 'picked-id' })),
  getDevices: vi.fn(async (ids: string[]) => ids.map((deviceId) => ({ deviceId }))),
  connect: vi.fn(async (_id: string, _onDisconnect?: (id: string) => void) => {}),
  disconnect: vi.fn(async () => {}),
  startNotifications: vi.fn(async () => {}),
}));
vi.mock('@capacitor-community/bluetooth-le', () => ({ BleClient: ble }));

const { CapacitorTransport } = await import('../src/capacitor/index.js');

describe('CapacitorTransport', () => {
  beforeEach(() => {
    vi.resetAllMocks(); // also drops queued one-off results, and restores the defaults above
  });

  it('without a deviceId, asks the user to pick the scale and exposes the picked id', async () => {
    const transport = new CapacitorTransport();
    expect(transport.deviceId).toBeUndefined();
    await transport.connect();
    expect(ble.requestDevice).toHaveBeenCalledOnce();
    expect(ble.requestDevice).toHaveBeenCalledWith(expect.objectContaining({ name: 'NSCALE' }));
    expect(ble.connect).toHaveBeenCalledWith('picked-id', expect.any(Function));
    expect(transport.deviceId).toBe('picked-id');
  });

  it('with showAllDevices, the chooser lists every device', async () => {
    await new CapacitorTransport({ showAllDevices: true }).connect();
    expect(ble.requestDevice).toHaveBeenCalledWith(expect.not.objectContaining({ name: expect.anything() }));
  });

  it('with a known deviceId, connects to it without the chooser', async () => {
    const transport = new CapacitorTransport({ deviceId: 'known-id' });
    await transport.connect();
    expect(ble.requestDevice).not.toHaveBeenCalled();
    expect(ble.getDevices).toHaveBeenCalledWith(['known-id']);
    expect(ble.connect).toHaveBeenCalledWith('known-id', expect.any(Function));
    expect(transport.deviceId).toBe('known-id');
  });

  it('with a known deviceId, still connects when getDevices() fails, e.g. Web Bluetooth without it', async () => {
    // navigator.bluetooth.getDevices() is behind a flag in Chrome; the plugin then throws. In the
    // same page session the plugin already knows the device from the first pick.
    ble.getDevices.mockRejectedValueOnce(new TypeError('navigator.bluetooth.getDevices is not a function'));
    const transport = new CapacitorTransport({ deviceId: 'known-id' });
    await transport.connect();
    expect(ble.connect).toHaveBeenCalledWith('known-id', expect.any(Function));
    expect(ble.requestDevice).not.toHaveBeenCalled();
  });

  it('with a known deviceId, still connects when getDevices() does not list it', async () => {
    ble.getDevices.mockResolvedValueOnce([]);
    const transport = new CapacitorTransport({ deviceId: 'known-id' });
    await transport.connect();
    expect(ble.connect).toHaveBeenCalledWith('known-id', expect.any(Function));
  });

  it('a known device that cannot be connected rejects with a clear error, keeping the cause, and never shows the chooser', async () => {
    const cause = new Error('Device not found. Call "requestDevice", "requestLEScan" or "getDevices" first.');
    ble.getDevices.mockResolvedValueOnce([]);
    ble.connect.mockRejectedValueOnce(cause);
    const transport = new CapacitorTransport({ deviceId: 'gone-id' });
    const error = await transport.connect().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/gone-id.*not available.*pick it again/);
    expect((error as Error).cause).toBe(cause);
    expect(ble.requestDevice).not.toHaveBeenCalled();
  });

  it('an undefined deviceId means the picker', async () => {
    const picked: string | undefined = undefined;
    const transport = new CapacitorTransport({ deviceId: picked });
    await transport.connect();
    expect(ble.requestDevice).toHaveBeenCalledOnce();
    expect(transport.deviceId).toBe('picked-id');
  });

  it('a new transport for the picked id reconnects to the same scale without the chooser', async () => {
    const first = new CapacitorTransport();
    await first.connect();
    await first.disconnect();

    const again = new CapacitorTransport({ deviceId: first.deviceId! });
    await again.connect();
    expect(ble.requestDevice).toHaveBeenCalledOnce();
    expect(ble.connect).toHaveBeenLastCalledWith('picked-id', expect.any(Function));
  });

  it('keeps deviceId when the connection itself fails, so the caller can retry with it', async () => {
    ble.connect.mockRejectedValueOnce(new Error('GATT error'));
    const transport = new CapacitorTransport();
    await expect(transport.connect()).rejects.toThrow('GATT error');
    expect(transport.deviceId).toBe('picked-id');
  });

  it('reports a device drop through onDisconnect', async () => {
    const transport = new CapacitorTransport({ deviceId: 'known-id' });
    const dropped = vi.fn();
    transport.onDisconnect(dropped);
    await transport.connect();
    const onDisconnect = ble.connect.mock.calls[0]![1]!;
    onDisconnect('known-id');
    expect(dropped).toHaveBeenCalledOnce();
  });

  it('disconnects and subscribes on the connected device', async () => {
    const transport = new CapacitorTransport({ deviceId: 'known-id' });
    await transport.connect();
    await transport.subscribe('0000ffb2-0000-1000-8000-00805f9b34fb', () => {});
    expect(ble.startNotifications).toHaveBeenCalledWith(
      'known-id',
      '0000ffb0-0000-1000-8000-00805f9b34fb',
      '0000ffb2-0000-1000-8000-00805f9b34fb',
      expect.any(Function),
    );
    await transport.disconnect();
    expect(ble.disconnect).toHaveBeenCalledWith('known-id');
  });
});
