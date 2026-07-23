import { Platform } from 'react-native';

import {
  PP_OCR_MODEL_VERSION,
} from '../ocr/ppocr/modelManifest';
import type { PpOcrResult } from '../ocr/ppocr/types';
import {
  ANDROID_KOREAN_TEXT_MODEL_VERSION,
  androidKoreanTextRecognizerEnabled,
  recognizeReceiptWithAndroidKoreanText,
  type AndroidKoreanTextRecognitionResult,
} from './androidKoreanTextRecognizer';

export type ReceiptRecognitionResult =
  | PpOcrResult
  | AndroidKoreanTextRecognitionResult;

export type ReceiptRecognitionCapability = {
  available: boolean;
  engine: 'ppocrv5' | 'mlkit-v2-korean';
  modelVersion: string;
  reason?: string;
};

export function receiptRecognitionCapability(
  platform: typeof Platform.OS,
): ReceiptRecognitionCapability {
  if (platform === 'android' || platform === 'ios') {
    if (platform === 'android' && androidKoreanTextRecognizerEnabled()) {
      return {
        available: true,
        engine: 'mlkit-v2-korean',
        modelVersion: ANDROID_KOREAN_TEXT_MODEL_VERSION,
      };
    }
    return {
      available: true,
      engine: 'ppocrv5',
      modelVersion: PP_OCR_MODEL_VERSION,
    };
  }
  return {
    available: false,
    engine: 'ppocrv5',
    modelVersion: PP_OCR_MODEL_VERSION,
    reason: `Receipt recognition is unavailable on ${platform}.`,
  };
}

export async function recognizeReceipt(
  imageUri: string,
): Promise<ReceiptRecognitionResult> {
  if (!imageUri.trim()) {
    throw new Error('A captured receipt image URI is required.');
  }

  const capability = receiptRecognitionCapability(Platform.OS);
  if (!capability.available) {
    throw new Error(capability.reason);
  }

  if (Platform.OS === 'android' && androidKoreanTextRecognizerEnabled()) {
    return recognizeReceiptWithAndroidKoreanText(imageUri);
  }

  const { recognizeReceiptWithPpOcr } = await import('../ocr/ppocr/runtime');
  return recognizeReceiptWithPpOcr(imageUri);
}
