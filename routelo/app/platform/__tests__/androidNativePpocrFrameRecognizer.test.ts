import {
  ANDROID_NATIVE_PPOCR_FRAME_RECOGNIZER_ENV,
  androidNativePpocrFrameRecognizerEnabled,
  androidNativePpocrFrameRecognizerStatusLabel,
  createAndroidNativePpocrFrameRecognizer,
  inspectAndroidNativePpocrFrameRecognizer,
  loadAndroidNativePpocrFrameRecognizerBinding,
} from '../androidNativePpocrFrameRecognizer';

const metadata = {
  source: 'native-frame' as const,
  width: 1280,
  height: 720,
  capturedAt: 1000,
  platform: 'android' as const,
  recognizerId: 'android-native-ppocr' as const,
};

describe('Android native PP-OCR frame recognizer bridge', () => {
  test('is enabled only by the explicit Android OCR flag', () => {
    expect(androidNativePpocrFrameRecognizerEnabled('1')).toBe(true);
    expect(androidNativePpocrFrameRecognizerEnabled('true')).toBe(false);
    expect(androidNativePpocrFrameRecognizerEnabled('0')).toBe(false);
    expect(androidNativePpocrFrameRecognizerEnabled(undefined)).toBe(false);
  });

  test('documents the public Expo flag name', () => {
    expect(ANDROID_NATIVE_PPOCR_FRAME_RECOGNIZER_ENV).toBe(
      'EXPO_PUBLIC_ROUTELO_ENABLE_ANDROID_NATIVE_PPOCR_FRAME_OCR',
    );
  });

  test('stays disabled until the Android native OCR flag is turned on', () => {
    expect(
      inspectAndroidNativePpocrFrameRecognizer({
        enabled: false,
        binding: null,
      }),
    ).toEqual({
      enabled: false,
      bundled: false,
      ready: false,
      reason:
        'Android native PP-OCR frame OCR is disabled. Still-photo OCR remains active.',
    });
  });

  test('fails closed when the flag is on but the binding is not bundled', async () => {
    const recognizer = createAndroidNativePpocrFrameRecognizer(null, {
      enabled: true,
    });

    await expect(
      recognizer.recognizeFrame({
        frame: {},
        metadata,
      }),
    ).rejects.toThrow(
      'Android native PP-OCR frame recognizer binding is not bundled',
    );
  });

  test('can call a bundled Android native binding', async () => {
    const recognizeFrame = jest.fn(async () => ({
      engine: 'ppocrv5' as const,
      rawText: 'android native text',
      fields: [],
      documentConfidence: 90,
      quality: {
        score: 90,
        blur: 90,
        brightness: 90,
        documentCoverage: 90,
        skew: 90,
        shadow: 90,
        passed: true,
        messages: [],
      },
      processingMs: 50,
      variantsCompared: 1,
      unmapped: [],
    }));

    const recognizer = createAndroidNativePpocrFrameRecognizer(
      {
        recognizeFrame,
      },
      {
        enabled: true,
      },
    );

    await expect(
      recognizer.recognizeFrame({
        frame: {},
        metadata,
      }),
    ).resolves.toMatchObject({
      rawText: 'android native text',
    });
    expect(recognizeFrame).toHaveBeenCalledTimes(1);
  });

  test('keeps a bundled scaffold unavailable until frame-buffer recognition is ready', async () => {
    const recognizer = createAndroidNativePpocrFrameRecognizer(
      {
        frameBufferRecognitionReady: false,
        recognizeFrame: jest.fn(),
      },
      {
        enabled: true,
      },
    );

    expect(recognizer.state).toEqual({
      enabled: true,
      bundled: true,
      ready: false,
      reason:
        'Android native PP-OCR binding is bundled, but direct VisionCamera frame-buffer recognition is not implemented yet.',
    });
    await expect(
      recognizer.recognizeFrame({
        frame: {},
        metadata,
      }),
    ).rejects.toThrow('direct VisionCamera frame-buffer recognition');
  });

  test('loads the Android native module scaffold as bundled but not ready', async () => {
    const recognizeFrameMetadata = jest.fn();
    const binding = loadAndroidNativePpocrFrameRecognizerBinding({
      platform: 'android',
      nativeModules: {
        RouteloAndroidPpocrFrameRecognizer: {
          frameBufferRecognitionReady: false,
          implementationStage: 'native-module-scaffold',
          recognizeFrameMetadata,
        },
      },
    });

    expect(binding).toMatchObject({
      frameBufferRecognitionReady: false,
      implementationStage: 'native-module-scaffold',
    });
    expect(
      inspectAndroidNativePpocrFrameRecognizer({
        binding,
        enabled: true,
      }),
    ).toMatchObject({
      bundled: true,
      ready: false,
    });
  });

  test('does not load the Android native module scaffold outside Android', () => {
    expect(
      loadAndroidNativePpocrFrameRecognizerBinding({
        platform: 'ios',
        nativeModules: {
          RouteloAndroidPpocrFrameRecognizer: {
            frameBufferRecognitionReady: true,
            recognizeFrameMetadata: jest.fn(),
          },
        },
      }),
    ).toBeNull();
  });

  test('summarizes Android native PP-OCR readiness', () => {
    expect(
      androidNativePpocrFrameRecognizerStatusLabel({
        enabled: false,
        bundled: false,
        ready: false,
      }),
    ).toBe('disabled');
    expect(
      androidNativePpocrFrameRecognizerStatusLabel({
        enabled: true,
        bundled: false,
        ready: false,
      }),
    ).toBe('binding missing');
    expect(
      androidNativePpocrFrameRecognizerStatusLabel({
        enabled: true,
        bundled: true,
        ready: false,
      }),
    ).toBe('bundled / not ready');
    expect(
      androidNativePpocrFrameRecognizerStatusLabel({
        enabled: true,
        bundled: true,
        ready: true,
      }),
    ).toBe('ready');
  });
});
