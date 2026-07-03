import {
  createVisionCameraFrameSource,
  inspectVisionCameraLiveOcrReadiness,
} from '../visionCameraFrameSource';

const visionModule = ({
  permission = 'authorized',
  granted = true,
  backCamera = { id: 'back' },
  devices = [{ id: 'back' }],
}: {
  permission?: 'not-determined' | 'authorized' | 'denied' | 'restricted';
  granted?: boolean;
  backCamera?: unknown;
  devices?: unknown[];
}) => ({
  VisionCamera: {
    cameraPermissionStatus: permission,
    requestCameraPermission: jest.fn(async () => granted),
    createDeviceFactory: jest.fn(async () => ({
      cameraDevices: devices,
      getDefaultCamera: jest.fn(() => backCamera),
    })),
  },
});

describe('VisionCamera live OCR readiness', () => {
  test('keeps web unsupported without loading VisionCamera', async () => {
    const loadVisionCamera = jest.fn(async () => visionModule({}));

    await expect(
      inspectVisionCameraLiveOcrReadiness({
        platform: 'web',
        loadVisionCamera,
      }),
    ).resolves.toMatchObject({
      ready: false,
      status: 'unsupported-platform',
      nativePackageAvailable: false,
    });
    expect(loadVisionCamera).not.toHaveBeenCalled();
  });

  test('reports permission required before requesting camera access', async () => {
    const native = visionModule({ permission: 'not-determined' });

    const readiness = await inspectVisionCameraLiveOcrReadiness({
      platform: 'android',
      loadVisionCamera: async () => native,
    });

    expect(readiness).toMatchObject({
      ready: false,
      status: 'permission-required',
      permissionStatus: 'not-determined',
      nativePackageAvailable: true,
      frameStreamingAvailable: false,
    });
    expect(native.VisionCamera.requestCameraPermission).not.toHaveBeenCalled();
  });

  test('can request permission and inspect the back camera without enabling streaming', async () => {
    const native = visionModule({
      permission: 'not-determined',
      granted: true,
      backCamera: { id: 'back' },
      devices: [{ id: 'back' }, { id: 'front' }],
    });

    const readiness = await inspectVisionCameraLiveOcrReadiness({
      platform: 'ios',
      requestPermission: true,
      loadVisionCamera: async () => native,
    });

    expect(readiness).toEqual({
      ready: false,
      status: 'frame-stream-not-wired',
      reason:
        'VisionCamera is installed, permission is granted, and a back camera is available. Preview frame streaming still needs to be wired into LiveOcrFrameScanner.',
      permissionStatus: 'authorized',
      cameraPermissionGranted: true,
      nativePackageAvailable: true,
      backCameraAvailable: true,
      cameraDeviceCount: 2,
      frameStreamingAvailable: false,
    });
    expect(native.VisionCamera.requestCameraPermission).toHaveBeenCalledTimes(1);
  });

  test('reports blocked permission without inspecting devices', async () => {
    const native = visionModule({ permission: 'denied' });

    const readiness = await inspectVisionCameraLiveOcrReadiness({
      platform: 'android',
      requestPermission: true,
      loadVisionCamera: async () => native,
    });

    expect(readiness).toMatchObject({
      ready: false,
      status: 'permission-blocked',
      permissionStatus: 'denied',
      cameraPermissionGranted: false,
      backCameraAvailable: false,
    });
    expect(native.VisionCamera.createDeviceFactory).not.toHaveBeenCalled();
  });

  test('reports no back camera when permission is granted but only other devices exist', async () => {
    const readiness = await inspectVisionCameraLiveOcrReadiness({
      platform: 'android',
      loadVisionCamera: async () =>
        visionModule({
          permission: 'authorized',
          backCamera: null,
          devices: [{ id: 'front' }],
        }),
    });

    expect(readiness).toMatchObject({
      ready: false,
      status: 'no-back-camera',
      cameraPermissionGranted: true,
      backCameraAvailable: false,
      cameraDeviceCount: 1,
    });
  });

  test('VisionCamera source still refuses to start until frame streaming is wired', async () => {
    const source = createVisionCameraFrameSource('android');

    expect(source.capability).toMatchObject({
      available: false,
      status: 'native-adapter-missing',
    });
    await expect(
      source.start({
        onFrame: jest.fn(),
      }),
    ).rejects.toThrow('preview frame streaming is not wired yet');
  });
});
