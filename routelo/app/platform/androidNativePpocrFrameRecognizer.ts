import type { OcrPipelineResult } from '../models';
import type { LiveOcrNativeFrameMetadata } from '../services/liveFrameScanner';
import { NativeModules, Platform } from 'react-native';

export const ANDROID_NATIVE_PPOCR_FRAME_RECOGNIZER_ENV =
  'EXPO_PUBLIC_ROUTELO_ENABLE_ANDROID_NATIVE_PPOCR_FRAME_OCR';

export type AndroidNativePpocrFrameRecognizeInput = {
  frame: unknown;
  metadata: LiveOcrNativeFrameMetadata & {
    platform: 'android';
    recognizerId: 'android-native-ppocr';
  };
};

export type AndroidNativePpocrFrameRecognizerBinding = {
  frameBufferRecognitionReady?: boolean;
  implementationStage?: string;
  recognizeFrame: (
    input: AndroidNativePpocrFrameRecognizeInput,
  ) => OcrPipelineResult | Promise<OcrPipelineResult>;
};

type AndroidNativePpocrFrameRecognizerModule = {
  getStatus?: () => Promise<{
    bundled?: boolean;
    frameBufferRecognitionReady?: boolean;
    implementationStage?: string;
    reason?: string;
  }>;
  recognizeFrameMetadata?: (
    metadata: AndroidNativePpocrFrameRecognizeInput['metadata'],
  ) => Promise<OcrPipelineResult>;
  frameBufferRecognitionReady?: boolean;
  implementationStage?: string;
};

export type AndroidNativePpocrFrameRecognizerState = {
  enabled: boolean;
  bundled: boolean;
  ready: boolean;
  reason?: string;
};

export function androidNativePpocrFrameRecognizerEnabled(
  value = process.env.EXPO_PUBLIC_ROUTELO_ENABLE_ANDROID_NATIVE_PPOCR_FRAME_OCR,
): boolean {
  return value === '1';
}

export function inspectAndroidNativePpocrFrameRecognizer(
  options: {
    enabled?: boolean;
    binding?: AndroidNativePpocrFrameRecognizerBinding | null;
  } = {},
): AndroidNativePpocrFrameRecognizerState {
  const enabled = options.enabled ?? androidNativePpocrFrameRecognizerEnabled();
  const bundled = Boolean(options.binding);
  const frameBufferRecognitionReady =
    options.binding?.frameBufferRecognitionReady ?? bundled;

  if (!enabled) {
    return {
      enabled: false,
      bundled,
      ready: false,
      reason:
        'Android native PP-OCR frame OCR is disabled. Still-photo OCR remains active.',
    };
  }

  if (!bundled) {
    return {
      enabled: true,
      bundled: false,
      ready: false,
      reason:
        'Android native PP-OCR frame recognizer binding is not bundled yet.',
    };
  }

  if (!frameBufferRecognitionReady) {
    return {
      enabled: true,
      bundled: true,
      ready: false,
      reason:
        'Android native PP-OCR binding is bundled, but direct VisionCamera frame-buffer recognition is not implemented yet.',
    };
  }

  return {
    enabled: true,
    bundled: true,
    ready: true,
  };
}

export function androidNativePpocrFrameRecognizerStatusLabel(
  state: AndroidNativePpocrFrameRecognizerState,
): string {
  if (state.ready) {
    return 'ready';
  }

  if (!state.enabled) {
    return 'disabled';
  }

  return state.bundled ? 'bundled / not ready' : 'binding missing';
}

export function loadAndroidNativePpocrFrameRecognizerBinding(
  options: {
    platform?: typeof Platform.OS;
    nativeModules?: typeof NativeModules;
  } = {},
): AndroidNativePpocrFrameRecognizerBinding | null {
  const platform = options.platform ?? Platform.OS;
  const nativeModules = options.nativeModules ?? NativeModules;

  if (platform !== 'android') {
    return null;
  }

  const nativeModule = nativeModules
    .RouteloAndroidPpocrFrameRecognizer as
    | AndroidNativePpocrFrameRecognizerModule
    | undefined;

  if (!nativeModule?.recognizeFrameMetadata) {
    return null;
  }

  return {
    frameBufferRecognitionReady:
      nativeModule.frameBufferRecognitionReady ?? false,
    implementationStage: nativeModule.implementationStage,
    recognizeFrame(input) {
      return nativeModule.recognizeFrameMetadata?.(input.metadata) as Promise<
        OcrPipelineResult
      >;
    },
  };
}

export function createAndroidNativePpocrFrameRecognizer(
  binding: AndroidNativePpocrFrameRecognizerBinding | null,
  options: {
    enabled?: boolean;
  } = {},
) {
  const state = inspectAndroidNativePpocrFrameRecognizer({
    binding,
    enabled: options.enabled,
  });

  return {
    state,
    async recognizeFrame(input: AndroidNativePpocrFrameRecognizeInput) {
      if (!state.ready || !binding) {
        throw new Error(
          state.reason ??
            'Android native PP-OCR frame recognizer is unavailable.',
        );
      }

      return binding.recognizeFrame(input);
    },
  };
}
