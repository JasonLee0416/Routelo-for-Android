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

  test('keeps Android disabled until the Android native PP-OCR flag is enabled', () => {
    expect(nativeFrameOcrRecognizerCapability('android')).toMatchObject({
      available: false,
      status: 'disabled',
      platform: 'android',
      directFrameBuffer: true,
      fallback: 'still-photo',
      reason:
        'Android native PP-OCR frame OCR is disabled. Still-photo OCR remains active.',
    });
  });

  test('keeps Android unavailable until the native PP-OCR binding is bundled', () => {
    expect(
      nativeFrameOcrRecognizerCapability('android', false, true),
    ).toMatchObject({
      available: false,
      status: 'native-recognizer-missing',
      platform: 'android',
      directFrameBuffer: true,
      fallback: 'still-photo',
      reason:
        'Android native PP-OCR frame recognizer binding is not bundled yet.',
    });
  });

  test('treats iOS as out of scope for this Android repository', () => {
    expect(nativeFrameOcrRecognizerCapability('ios')).toMatchObject({
      available: false,
      status: 'ios-out-of-scope',
      platform: 'ios',
      directFrameBuffer: false,
      fallback: 'still-photo',
      reason:
        'iOS native OCR is out of scope for this Android-focused repository. Use the dedicated Routelo for iOS repository.',
    });
  });

  test('describes the Android recognizer when native bindings exist', () => {
    expect(
      nativeFrameOcrRecognizerCapability('android', true, true),
    ).toMatchObject({
      available: true,
      status: 'available',
      recognizerId: 'android-native-ppocr',
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
    ).rejects.toThrow('Android native PP-OCR frame OCR is disabled');
  });
});
