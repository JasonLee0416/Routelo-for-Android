import type { OcrPipelineResult } from '../models';
import type { LiveOcrNativeFrameMetadata } from '../services/liveFrameScanner';

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
  recognizeFrame: (
    input: AndroidNativePpocrFrameRecognizeInput,
  ) => OcrPipelineResult | Promise<OcrPipelineResult>;
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

  return state.bundled ? 'initializing' : 'binding missing';
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
