import { Platform } from 'react-native';

import type { LiveOcrFrameAsset } from '../services/liveFrameScanner';

export type LiveCameraFrameSourceStatus =
  | 'available'
  | 'native-adapter-missing'
  | 'unsupported-platform';

export type LiveCameraFrameSourceCapability = {
  available: boolean;
  status: LiveCameraFrameSourceStatus;
  reason?: string;
  fallback: 'still-photo';
  recommendedMinIntervalMs: number;
};

export type LiveCameraFrameSubscription = {
  stop: () => void | Promise<void>;
};

export type LiveCameraFrameSource = {
  capability: LiveCameraFrameSourceCapability;
  start: (callbacks: {
    onFrame: (frame: LiveOcrFrameAsset) => void | Promise<void>;
    onError?: (error: Error) => void;
  }) => Promise<LiveCameraFrameSubscription>;
};

const RECOMMENDED_MIN_INTERVAL_MS = 500;

export function liveCameraFrameSourceCapability(
  platform: typeof Platform.OS,
  hasNativeAdapter = false,
): LiveCameraFrameSourceCapability {
  if (platform !== 'android' && platform !== 'ios') {
    return {
      available: false,
      status: 'unsupported-platform',
      reason: `Live camera OCR is unavailable on ${platform}.`,
      fallback: 'still-photo',
      recommendedMinIntervalMs: RECOMMENDED_MIN_INTERVAL_MS,
    };
  }

  if (!hasNativeAdapter) {
    return {
      available: false,
      status: 'native-adapter-missing',
      reason:
        'Live camera OCR requires a native preview-frame adapter. Use still-photo OCR until that adapter is bundled in the development build.',
      fallback: 'still-photo',
      recommendedMinIntervalMs: RECOMMENDED_MIN_INTERVAL_MS,
    };
  }

  return {
    available: true,
    status: 'available',
    fallback: 'still-photo',
    recommendedMinIntervalMs: RECOMMENDED_MIN_INTERVAL_MS,
  };
}

export function createUnavailableLiveCameraFrameSource(
  platform: typeof Platform.OS = Platform.OS,
): LiveCameraFrameSource {
  const capability = liveCameraFrameSourceCapability(platform, false);
  return {
    capability,
    async start() {
      throw new Error(capability.reason);
    },
  };
}

export const liveCameraFrameSource = createUnavailableLiveCameraFrameSource();
