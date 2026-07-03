import { Platform } from 'react-native';

import type { OcrPipelineResult } from '../models';
import type { LiveOcrNativeFrameMetadata } from '../services/liveFrameScanner';

export type NativeFrameOcrRecognizerId =
  | 'android-native-ppocr'
  | 'ios-apple-vision'
  | 'ios-clova-fallback';

export type NativeFrameOcrRecognizerStatus =
  | 'available'
  | 'unsupported-platform'
  | 'native-recognizer-missing'
  | 'cloud-consent-required';

export type NativeFrameOcrRecognizerCapability = {
  available: boolean;
  status: NativeFrameOcrRecognizerStatus;
  recognizerId?: NativeFrameOcrRecognizerId;
  platform: typeof Platform.OS;
  directFrameBuffer: boolean;
  fallback: 'still-photo' | 'manual-entry' | 'cloud-consent';
  reason?: string;
};

export type NativeFrameOcrRecognizeInput = {
  frame: unknown;
  metadata: LiveOcrNativeFrameMetadata;
};

export type NativeFrameOcrRecognizer = {
  capability: NativeFrameOcrRecognizerCapability;
  recognizeFrame: (
    input: NativeFrameOcrRecognizeInput,
  ) => OcrPipelineResult | Promise<OcrPipelineResult>;
};

export function nativeFrameOcrRecognizerCapability(
  platform: typeof Platform.OS,
  hasNativeRecognizer = false,
): NativeFrameOcrRecognizerCapability {
  if (platform !== 'android' && platform !== 'ios') {
    return {
      available: false,
      status: 'unsupported-platform',
      platform,
      directFrameBuffer: false,
      fallback: 'still-photo',
      reason: `Native frame OCR is unavailable on ${platform}.`,
    };
  }

  if (!hasNativeRecognizer) {
    return {
      available: false,
      status: 'native-recognizer-missing',
      platform,
      directFrameBuffer: true,
      fallback: 'still-photo',
      reason:
        platform === 'android'
          ? 'Android native PP-OCR frame recognizer is not bundled yet.'
          : 'iOS Apple Vision frame recognizer is not bundled yet.',
    };
  }

  return {
    available: true,
    status: 'available',
    recognizerId:
      platform === 'android' ? 'android-native-ppocr' : 'ios-apple-vision',
    platform,
    directFrameBuffer: true,
    fallback: 'still-photo',
  };
}

export function createUnavailableNativeFrameOcrRecognizer(
  platform: typeof Platform.OS = Platform.OS,
): NativeFrameOcrRecognizer {
  const capability = nativeFrameOcrRecognizerCapability(platform, false);
  return {
    capability,
    async recognizeFrame() {
      throw new Error(
        capability.reason ??
          'Native frame OCR recognizer is unavailable. Use still-photo OCR.',
      );
    },
  };
}

export const nativeFrameOcrRecognizer =
  createUnavailableNativeFrameOcrRecognizer();
