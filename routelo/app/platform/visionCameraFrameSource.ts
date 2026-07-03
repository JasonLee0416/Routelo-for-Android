import { Platform } from 'react-native';

import type { LiveCameraFrameSource } from './liveCameraFrameSource';
import { liveCameraFrameSourceCapability } from './liveCameraFrameSource';

type VisionCameraPermissionStatus =
  | 'not-determined'
  | 'authorized'
  | 'denied'
  | 'restricted';

type VisionCameraDeviceFactory = {
  cameraDevices?: unknown[];
  getDefaultCamera: (position: 'back' | 'front' | 'external') => unknown;
};

type VisionCameraApi = {
  cameraPermissionStatus: VisionCameraPermissionStatus;
  requestCameraPermission: () => Promise<boolean>;
  createDeviceFactory: () => Promise<VisionCameraDeviceFactory>;
};

type VisionCameraModule = {
  VisionCamera: VisionCameraApi;
};

export type VisionCameraLiveOcrReadinessStatus =
  | 'unsupported-platform'
  | 'native-package-unavailable'
  | 'permission-required'
  | 'permission-blocked'
  | 'no-back-camera'
  | 'frame-stream-not-wired';

export type VisionCameraLiveOcrReadiness = {
  ready: false;
  status: VisionCameraLiveOcrReadinessStatus;
  reason: string;
  permissionStatus?: VisionCameraPermissionStatus;
  cameraPermissionGranted: boolean;
  nativePackageAvailable: boolean;
  backCameraAvailable: boolean;
  cameraDeviceCount: number;
  frameStreamingAvailable: false;
};

export type VisionCameraFrameSourceOptions = {
  platform?: typeof Platform.OS;
  requestPermission?: boolean;
  loadVisionCamera?: () => Promise<VisionCameraModule>;
};

const unsupported = (
  platform: typeof Platform.OS,
): VisionCameraLiveOcrReadiness => ({
  ready: false,
  status: 'unsupported-platform',
  reason: `VisionCamera live OCR is unavailable on ${platform}.`,
  cameraPermissionGranted: false,
  nativePackageAvailable: false,
  backCameraAvailable: false,
  cameraDeviceCount: 0,
  frameStreamingAvailable: false,
});

const loadInstalledVisionCamera = () =>
  import('react-native-vision-camera') as Promise<VisionCameraModule>;

export async function inspectVisionCameraLiveOcrReadiness(
  options: VisionCameraFrameSourceOptions = {},
): Promise<VisionCameraLiveOcrReadiness> {
  const platform = options.platform ?? Platform.OS;
  if (platform !== 'android' && platform !== 'ios') {
    return unsupported(platform);
  }

  let native: VisionCameraModule;
  try {
    native = await (options.loadVisionCamera ?? loadInstalledVisionCamera)();
  } catch (error) {
    return {
      ready: false,
      status: 'native-package-unavailable',
      reason:
        error instanceof Error
          ? error.message
          : 'VisionCamera native package is unavailable.',
      cameraPermissionGranted: false,
      nativePackageAvailable: false,
      backCameraAvailable: false,
      cameraDeviceCount: 0,
      frameStreamingAvailable: false,
    };
  }

  const { VisionCamera } = native;
  let permissionStatus = VisionCamera.cameraPermissionStatus;
  let cameraPermissionGranted = permissionStatus === 'authorized';
  if (
    !cameraPermissionGranted &&
    options.requestPermission &&
    permissionStatus === 'not-determined'
  ) {
    cameraPermissionGranted = await VisionCamera.requestCameraPermission();
    permissionStatus = cameraPermissionGranted ? 'authorized' : 'denied';
  }

  if (!cameraPermissionGranted) {
    const blocked =
      permissionStatus === 'denied' || permissionStatus === 'restricted';
    return {
      ready: false,
      status: blocked ? 'permission-blocked' : 'permission-required',
      reason: blocked
        ? 'Camera permission is denied or restricted. Still-photo OCR remains the fallback.'
        : 'Camera permission is required before VisionCamera can inspect preview devices.',
      permissionStatus,
      cameraPermissionGranted: false,
      nativePackageAvailable: true,
      backCameraAvailable: false,
      cameraDeviceCount: 0,
      frameStreamingAvailable: false,
    };
  }

  const deviceFactory = await VisionCamera.createDeviceFactory();
  const backCamera = deviceFactory.getDefaultCamera('back');
  const cameraDeviceCount = deviceFactory.cameraDevices?.length ?? 0;
  if (!backCamera) {
    return {
      ready: false,
      status: 'no-back-camera',
      reason:
        'VisionCamera is installed and permission is granted, but no back camera is available.',
      permissionStatus,
      cameraPermissionGranted: true,
      nativePackageAvailable: true,
      backCameraAvailable: false,
      cameraDeviceCount,
      frameStreamingAvailable: false,
    };
  }

  return {
    ready: false,
    status: 'frame-stream-not-wired',
    reason:
      'VisionCamera is installed, permission is granted, and a back camera is available. Preview frame streaming still needs to be wired into LiveOcrFrameScanner.',
    permissionStatus,
    cameraPermissionGranted: true,
    nativePackageAvailable: true,
    backCameraAvailable: true,
    cameraDeviceCount,
    frameStreamingAvailable: false,
  };
}

export function createVisionCameraFrameSource(
  platform: typeof Platform.OS = Platform.OS,
): LiveCameraFrameSource {
  return {
    capability: liveCameraFrameSourceCapability(platform, false),
    async start() {
      throw new Error(
        'VisionCamera capability detection is available, but preview frame streaming is not wired yet.',
      );
    },
  };
}
