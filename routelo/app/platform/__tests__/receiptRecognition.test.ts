import { receiptRecognitionCapability } from '../receiptRecognition';
import { ANDROID_KOREAN_TEXT_MODEL_VERSION } from '../androidKoreanTextRecognizer';

describe('receiptRecognitionCapability', () => {
  const previousEngine = process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE;

  afterEach(() => {
    if (previousEngine === undefined) {
      delete process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE;
    } else {
      process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE = previousEngine;
    }
  });

  test('uses the same pinned PP-OCR model on Android', () => {
    delete process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE;
    expect(receiptRecognitionCapability('android')).toEqual({
      available: true,
      engine: 'ppocrv5',
      modelVersion: 'rapidocr-v3.8.0-ppocrv5',
    });
  });

  test('can switch Android test APKs to the official Korean text recognizer', () => {
    process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE = 'android-korean-text';
    expect(receiptRecognitionCapability('android')).toEqual({
      available: true,
      engine: 'mlkit-v2-korean',
      modelVersion: ANDROID_KOREAN_TEXT_MODEL_VERSION,
    });
  });

  test('uses the same pinned PP-OCR model on iOS', () => {
    process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE = 'android-korean-text';
    expect(receiptRecognitionCapability('ios')).toEqual({
      available: true,
      engine: 'ppocrv5',
      modelVersion: 'rapidocr-v3.8.0-ppocrv5',
    });
  });

  test('does not silently substitute OCR on web', () => {
    expect(receiptRecognitionCapability('web')).toEqual({
      available: false,
      engine: 'ppocrv5',
      modelVersion: 'rapidocr-v3.8.0-ppocrv5',
      reason: 'Receipt recognition is unavailable on web.',
    });
  });
});
