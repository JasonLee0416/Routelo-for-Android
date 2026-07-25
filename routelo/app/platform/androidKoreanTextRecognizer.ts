import { NativeModules, Platform } from 'react-native';

import { resolvePrimaryEngine } from '../config/ocrRuntimeConfig';
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
  // config와 동일한 단일 헬퍼로 결정한다(drift 방지). 기본은 온디바이스 한국어
  // 엔진, PP-OCR 강제(EXPO_PUBLIC_ROUTELO_OCR_ENGINE=ppocrv5)일 때만 끈다.
  return (
    resolvePrimaryEngine(env?.EXPO_PUBLIC_ROUTELO_OCR_ENGINE) ===
    'android-korean-text'
  );
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
