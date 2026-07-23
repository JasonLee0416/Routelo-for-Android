import * as FileSystem from 'expo-file-system/legacy';
import {
  manipulateAsync,
  SaveFormat,
  type ImageResult,
} from 'expo-image-manipulator';

import { inspectCaptureQuality } from './ocr';

export type ReceiptImageInput = {
  uri: string;
  width?: number;
  height?: number;
  fileSize?: number;
};

export type PreparedReceiptImage = ReceiptImageInput & {
  originalUri: string;
  normalized: boolean;
  preparationMessages: string[];
};

const OCR_TARGET_LONG_SIDE = 2400;
const OCR_MIN_SHORT_SIDE = 1080;

async function fileSize(uri: string, fallback?: number) {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && 'size' in info && typeof info.size === 'number'
    ? info.size
    : fallback;
}

function resizeAction(width?: number, height?: number) {
  if (!width || !height) return undefined;
  const longSide = Math.max(width, height);
  if (longSide <= OCR_TARGET_LONG_SIDE) return undefined;
  const scale = OCR_TARGET_LONG_SIDE / longSide;
  return {
    resize: {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    },
  };
}

function imageInfo(
  result: ImageResult,
  fallback: ReceiptImageInput,
): ReceiptImageInput {
  return {
    uri: result.uri,
    width: result.width || fallback.width,
    height: result.height || fallback.height,
    fileSize: fallback.fileSize,
  };
}

export async function prepareReceiptImageForOcr(
  input: ReceiptImageInput,
): Promise<PreparedReceiptImage> {
  const action = resizeAction(input.width, input.height);
  const preparationMessages: string[] = [];
  const beforeQuality = inspectCaptureQuality(input);
  if (Math.min(input.width || 0, input.height || 0) < OCR_MIN_SHORT_SIDE) {
    preparationMessages.push(
      'OCR 입력 이미지의 짧은 변이 작습니다. 인수증을 더 가까이, 흔들림 없이 촬영해야 합니다.',
    );
  }
  if (!beforeQuality.passed) {
    preparationMessages.push(...beforeQuality.messages);
  }

  if (!action) {
    return {
      ...input,
      fileSize: await fileSize(input.uri, input.fileSize),
      originalUri: input.uri,
      normalized: false,
      preparationMessages,
    };
  }

  const result = await manipulateAsync(input.uri, [action], {
    compress: 1,
    format: SaveFormat.JPEG,
  });
  const prepared = imageInfo(result, input);
  return {
    ...prepared,
    fileSize: await fileSize(prepared.uri, input.fileSize),
    originalUri: input.uri,
    normalized: true,
    preparationMessages: [
      ...preparationMessages,
      `OCR 안정화를 위해 긴 변을 ${OCR_TARGET_LONG_SIDE}px 기준으로 정규화했습니다.`,
    ],
  };
}
