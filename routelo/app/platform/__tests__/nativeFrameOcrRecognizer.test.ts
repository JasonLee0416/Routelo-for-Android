import {
  createUnavailableNativeFrameOcrRecognizer,
  nativeFrameOcrRecognizerCapability,
} from '../nativeFrameOcrRecognizer';

describe('native frame OCR recognizer contract', () => {
  test('reports unsupported platforms without direct frame OCR', () => {
    expect(nativeFrameOcrRecognizerCapability('web')).toEqual({
      available: false,
      status: 'unsupported-platform',
      platform: 'web',
      directFrameBuffer: false,
      fallback: 'still-photo',
      reason: 'Native frame OCR is unavailable on web.',
    });
  });

  test('keeps Android unavailable until the native PP-OCR recognizer is bundled', () => {
    expect(nativeFrameOcrRecognizerCapability('android')).toMatchObject({
      available: false,
      status: 'native-recognizer-missing',
      platform: 'android',
      directFrameBuffer: true,
      fallback: 'still-photo',
      reason: 'Android native PP-OCR frame recognizer is not bundled yet.',
    });
  });

  test('keeps iOS unavailable until the Apple Vision recognizer is bundled', () => {
    expect(nativeFrameOcrRecognizerCapability('ios')).toMatchObject({
      available: false,
      status: 'native-recognizer-missing',
      platform: 'ios',
      directFrameBuffer: true,
      fallback: 'still-photo',
      reason: 'iOS Apple Vision frame recognizer is not bundled yet.',
    });
  });

  test('describes the Android and iOS recognizers when native bindings exist', () => {
    expect(nativeFrameOcrRecognizerCapability('android', true)).toMatchObject({
      available: true,
      status: 'available',
      recognizerId: 'android-native-ppocr',
      directFrameBuffer: true,
    });
    expect(nativeFrameOcrRecognizerCapability('ios', true)).toMatchObject({
      available: true,
      status: 'available',
      recognizerId: 'ios-apple-vision',
      directFrameBuffer: true,
    });
  });

  test('default recognizer fails closed instead of pretending OCR is available', async () => {
    const recognizer = createUnavailableNativeFrameOcrRecognizer('android');

    await expect(
      recognizer.recognizeFrame({
        frame: {},
        metadata: {
          source: 'native-frame',
          width: 1280,
          height: 720,
          capturedAt: 1000,
          platform: 'android',
          recognizerId: 'android-native-ppocr',
        },
      }),
    ).rejects.toThrow('Android native PP-OCR frame recognizer is not bundled');
  });
});
