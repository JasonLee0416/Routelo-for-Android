import { Platform } from 'react-native';

import type { OcrPipelineResult } from '../models';
import type { LiveOcrNativeFrameMetadata } from '../services/liveFrameScanner';
import {
  androidNativePpocrFrameRecognizerEnabled,
  inspectAndroidNativePpocrFrameRecognizer,
  type AndroidNativePpocrFrameRecognizerBinding,
} from './androidNativePpocrFrameRecognizer';

export type NativeFrameOcrRecognizerId =
  | 'android-native-ppocr'
  | 'clova-cloud-fallback';

export type NativeFrameOcrRecognizerStatus =
  | 'available'
  | 'unsupported-platform'
  | 'ios-out-of-scope'
  | 'disabled'
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
  enabled = androidNativePpocrFrameRecognizerEnabled(),
): NativeFrameOcrRecognizerCapability {
  if (platform === 'ios') {
    return {
      available: false,
      status: 'ios-out-of-scope',
      platform,
      directFrameBuffer: false,
      fallback: 'still-photo',
      reason:
        'iOS native OCR is out of scope for this Android-focused repository. Use the dedicated Routelo for iOS repository.',
    };
  }

  if (platform !== 'android') {
    return {
      available: false,
      status: 'unsupported-platform',
      platform,
      directFrameBuffer: false,
      fallback: 'still-photo',
      reason: `Native frame OCR is unavailable on ${platform}.`,
    };
  }

  const androidState = inspectAndroidNativePpocrFrameRecognizer({
    enabled,
    binding: hasNativeRecognizer
      ? ({
          recognizeFrame() {
            throw new Error('Capability probe binding must not run.');
          },
        } satisfies AndroidNativePpocrFrameRecognizerBinding)
      : null,
  });

  if (!androidState.enabled) {
    return {
      available: false,
      status: 'disabled',
      platform,
      directFrameBuffer: true,
      fallback: 'still-photo',
      reason: androidState.reason,
    };
  }

  if (!androidState.ready) {
    return {
      available: false,
      status: 'native-recognizer-missing',
      platform,
      directFrameBuffer: true,
      fallback: 'still-photo',
      reason: androidState.reason,
    };
  }

  return {
    available: true,
    status: 'available',
    recognizerId: 'android-native-ppocr',
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
