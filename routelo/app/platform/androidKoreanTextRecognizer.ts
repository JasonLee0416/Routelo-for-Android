import { NativeModules, Platform } from 'react-native';

import type { OcrEngineDiagnostics } from '../models';

export const ANDROID_KOREAN_TEXT_MODEL_VERSION = [
  'com.google',
  'mlkit:text-recognition-korean:16.0.1',
].join('.');

export type AndroidKoreanTextLine = {
  text: string;
  confidence?: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type AndroidKoreanTextRecognitionResult = {
  engine: 'mlkit-v2-korean';
  modelVersion: typeof ANDROID_KOREAN_TEXT_MODEL_VERSION;
  fullText: string;
  lines: AndroidKoreanTextLine[];
  processingMs: number;
  diagnostics?: OcrEngineDiagnostics;
};

type NativeAndroidKoreanTextRecognizer = {
  recognizeImage: (imageUri: string) => Promise<AndroidKoreanTextRecognitionResult>;
};

type RouteloEnv = {
  EXPO_PUBLIC_ROUTELO_OCR_ENGINE?: string;
};

const runtimeEnv = () =>
  (globalThis as { process?: { env?: RouteloEnv } }).process?.env;

export function androidKoreanTextRecognizerEnabled(
  env: RouteloEnv | undefined = runtimeEnv(),
) {
  // 기본 주 엔진은 온디바이스 한국어 텍스트 인식(실기기 확증: 같은 인수증에서
  // PP-OCR는 no-text/0필드, 이 엔진은 6필드 —
  // docs/ocr-benchmark/2026-07-25-device-engine-verification.md).
  // PP-OCR을 주 엔진으로 강제(EXPO_PUBLIC_ROUTELO_OCR_ENGINE=ppocrv5)할 때만 끈다.
  // ocrRuntimeConfig.primaryEngine과 동일 기준(env=ppocrv5 → ppocrv5, 그 외 → korean).
  return env?.EXPO_PUBLIC_ROUTELO_OCR_ENGINE !== 'ppocrv5';
}

function nativeModule(): NativeAndroidKoreanTextRecognizer | undefined {
  return NativeModules.RouteloAndroidKoreanTextRecognizer as
    | NativeAndroidKoreanTextRecognizer
    | undefined;
}

export async function recognizeReceiptWithAndroidKoreanText(
  imageUri: string,
): Promise<AndroidKoreanTextRecognitionResult> {
  if (Platform.OS !== 'android') {
    throw new Error('Android Korean text recognizer is Android-only.');
  }
  const module = nativeModule();
  if (!module?.recognizeImage) {
    throw new Error(
      'Android Korean text recognizer native module is not bundled. Rebuild the standalone APK.',
    );
  }
  return module.recognizeImage(imageUri);
}
