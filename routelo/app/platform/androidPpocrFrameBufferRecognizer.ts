import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';
import { Platform } from 'react-native';

import type { OcrPipelineResult } from '../models';
import type { LiveOcrNativeFrameMetadata } from '../services/liveFrameScanner';
import { androidNativePpocrFrameRecognizerEnabled } from './androidNativePpocrFrameRecognizer';

declare const require: (moduleName: string) => unknown;

export const ANDROID_PPOCR_FRAME_BUFFER_RECOGNIZER_HYBRID_OBJECT =
  'RouteloAndroidPpocrFrameBufferRecognizer';

export type AndroidPpocrFrameBufferMetadata = LiveOcrNativeFrameMetadata & {
  platform: 'android';
  recognizerId: 'android-native-ppocr';
};

export type AndroidPpocrFrameBufferRecognizer = HybridObject<{
  android: 'kotlin';
}> & {
  readonly frameBufferRecognitionReady: boolean;
  readonly implementationStage: string;
  recognizeFrame: (
    frame: Frame,
    metadata: AndroidPpocrFrameBufferMetadata,
  ) => OcrPipelineResult | null;
};

export type AndroidPpocrFrameBufferRecognizerState = {
  enabled: boolean;
  registered: boolean;
  ready: boolean;
  reason?: string;
};

type NitroModulesProxyLike = {
  hasHybridObject?: (name: string) => boolean;
  createHybridObject?: <T>(name: string) => T;
};

function loadNitroModulesProxy(): NitroModulesProxyLike | null {
  try {
    return (
      require('react-native-nitro-modules') as {
        NitroModules?: NitroModulesProxyLike;
      }
    ).NitroModules ?? null;
  } catch {
    return null;
  }
}

export function inspectAndroidPpocrFrameBufferRecognizer(
  options: {
    enabled?: boolean;
    recognizer?: AndroidPpocrFrameBufferRecognizer | null;
  } = {},
): AndroidPpocrFrameBufferRecognizerState {
  const enabled = options.enabled ?? androidNativePpocrFrameRecognizerEnabled();
  const registered = Boolean(options.recognizer);

  if (!enabled) {
    return {
      enabled: false,
      registered,
      ready: false,
      reason:
        'Android native PP-OCR frame-buffer OCR is disabled. Still-photo OCR remains active.',
    };
  }

  if (!registered) {
    return {
      enabled: true,
      registered: false,
      ready: false,
      reason:
        'Android PP-OCR frame-buffer Nitro recognizer is not registered yet.',
    };
  }

  if (!options.recognizer?.frameBufferRecognitionReady) {
    return {
      enabled: true,
      registered: true,
      ready: false,
      reason:
        'Android PP-OCR frame-buffer recognizer is registered, but native inference is not ready yet.',
    };
  }

  return {
    enabled: true,
    registered: true,
    ready: true,
  };
}

export function androidPpocrFrameBufferRecognizerStatusLabel(
  state: AndroidPpocrFrameBufferRecognizerState,
): string {
  if (state.ready) {
    return 'ready';
  }

  if (!state.enabled) {
    return 'disabled';
  }

  return state.registered ? 'registered / not ready' : 'nitro missing';
}

export function loadAndroidPpocrFrameBufferRecognizer(
  options: {
    platform?: typeof Platform.OS;
    nitroModules?: NitroModulesProxyLike | null;
  } = {},
): AndroidPpocrFrameBufferRecognizer | null {
  const platform = options.platform ?? Platform.OS;

  if (platform !== 'android') {
    return null;
  }

  const nitroModules =
    options.nitroModules === undefined
      ? loadNitroModulesProxy()
      : options.nitroModules;

  if (!nitroModules?.hasHybridObject?.(ANDROID_PPOCR_FRAME_BUFFER_RECOGNIZER_HYBRID_OBJECT)) {
    return null;
  }

  try {
    return (
      nitroModules.createHybridObject?.<AndroidPpocrFrameBufferRecognizer>(
        ANDROID_PPOCR_FRAME_BUFFER_RECOGNIZER_HYBRID_OBJECT,
      ) ?? null
    );
  } catch {
    return null;
  }
}
