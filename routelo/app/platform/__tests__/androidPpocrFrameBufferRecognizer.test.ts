import {
  ANDROID_PPOCR_FRAME_BUFFER_RECOGNIZER_HYBRID_OBJECT,
  androidPpocrFrameBufferRecognizerStatusLabel,
  inspectAndroidPpocrFrameBufferRecognizer,
  loadAndroidPpocrFrameBufferRecognizer,
} from '../androidPpocrFrameBufferRecognizer';

describe('Android PP-OCR frame-buffer Nitro recognizer contract', () => {
  test('documents the HybridObject name that native Android must register', () => {
    expect(ANDROID_PPOCR_FRAME_BUFFER_RECOGNIZER_HYBRID_OBJECT).toBe(
      'RouteloAndroidPpocrFrameBufferRecognizer',
    );
  });

  test('stays disabled until the Android native PP-OCR flag is enabled', () => {
    expect(
      inspectAndroidPpocrFrameBufferRecognizer({
        enabled: false,
        recognizer: null,
      }),
    ).toEqual({
      enabled: false,
      registered: false,
      ready: false,
      reason:
        'Android native PP-OCR frame-buffer OCR is disabled. Still-photo OCR remains active.',
    });
  });

  test('fails closed when the Nitro HybridObject is not registered', () => {
    expect(
      inspectAndroidPpocrFrameBufferRecognizer({
        enabled: true,
        recognizer: null,
      }),
    ).toEqual({
      enabled: true,
      registered: false,
      ready: false,
      reason:
        'Android PP-OCR frame-buffer Nitro recognizer is not registered yet.',
    });
  });

  test('treats a registered but incomplete native recognizer as unavailable', () => {
    expect(
      inspectAndroidPpocrFrameBufferRecognizer({
        enabled: true,
        recognizer: {
          frameBufferRecognitionReady: false,
          implementationStage: 'nitro-scaffold',
          recognizeFrame: jest.fn(),
        } as never,
      }),
    ).toEqual({
      enabled: true,
      registered: true,
      ready: false,
      reason:
        'Android PP-OCR frame-buffer recognizer is registered, but native inference is not ready yet.',
    });
  });

  test('reports ready only when the recognizer is registered and inference-ready', () => {
    expect(
      inspectAndroidPpocrFrameBufferRecognizer({
        enabled: true,
        recognizer: {
          frameBufferRecognitionReady: true,
          implementationStage: 'ppocr-frame-buffer',
          recognizeFrame: jest.fn(),
        } as never,
      }),
    ).toEqual({
      enabled: true,
      registered: true,
      ready: true,
    });
  });

  test('loads the registered Android Nitro HybridObject', () => {
    const recognizer = {
      frameBufferRecognitionReady: true,
      implementationStage: 'ppocr-frame-buffer',
      recognizeFrame: jest.fn(),
    };
    const nitroModules = {
      hasHybridObject: jest.fn(() => true),
      createHybridObject: jest.fn(() => recognizer),
    };

    expect(
      loadAndroidPpocrFrameBufferRecognizer({
        platform: 'android',
        nitroModules: nitroModules as never,
      }),
    ).toBe(recognizer);
    expect(nitroModules.hasHybridObject).toHaveBeenCalledWith(
      ANDROID_PPOCR_FRAME_BUFFER_RECOGNIZER_HYBRID_OBJECT,
    );
    expect(nitroModules.createHybridObject).toHaveBeenCalledWith(
      ANDROID_PPOCR_FRAME_BUFFER_RECOGNIZER_HYBRID_OBJECT,
    );
  });

  test('does not load the frame-buffer recognizer outside Android', () => {
    expect(
      loadAndroidPpocrFrameBufferRecognizer({
        platform: 'web',
        nitroModules: {
          hasHybridObject: jest.fn(() => true),
          createHybridObject: jest.fn(),
        },
      }),
    ).toBeNull();
  });

  test('summarizes recognizer readiness for the probe UI', () => {
    expect(
      androidPpocrFrameBufferRecognizerStatusLabel({
        enabled: false,
        registered: false,
        ready: false,
      }),
    ).toBe('disabled');
    expect(
      androidPpocrFrameBufferRecognizerStatusLabel({
        enabled: true,
        registered: false,
        ready: false,
      }),
    ).toBe('nitro missing');
    expect(
      androidPpocrFrameBufferRecognizerStatusLabel({
        enabled: true,
        registered: true,
        ready: false,
      }),
    ).toBe('registered / not ready');
    expect(
      androidPpocrFrameBufferRecognizerStatusLabel({
        enabled: true,
        registered: true,
        ready: true,
      }),
    ).toBe('ready');
  });
});
