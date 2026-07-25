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

  test('defaults to the on-device Korean text recognizer on Android', () => {
    // 기본 주 엔진은 온디바이스 한국어 텍스트 인식(실기기 확증: PP-OCR는 no-text).
    delete process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE;
    expect(receiptRecognitionCapability('android')).toEqual({
      available: true,
      engine: 'mlkit-v2-korean',
      modelVersion: ANDROID_KOREAN_TEXT_MODEL_VERSION,
    });
  });

  test('keeps the on-device Korean recognizer when explicitly selected', () => {
    process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE = 'android-korean-text';
    expect(receiptRecognitionCapability('android')).toEqual({
      available: true,
      engine: 'mlkit-v2-korean',
      modelVersion: ANDROID_KOREAN_TEXT_MODEL_VERSION,
    });
  });

  test('can force PP-OCR as the Android engine via opt-in env', () => {
    process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE = 'ppocrv5';
    expect(receiptRecognitionCapability('android')).toEqual({
      available: true,
      engine: 'ppocrv5',
      modelVersion: 'rapidocr-v3.8.0-ppocrv5',
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
