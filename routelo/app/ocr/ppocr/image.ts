import { toByteArray } from 'base64-js';
import {
  manipulateAsync,
  SaveFormat,
  type Action,
} from 'expo-image-manipulator';
import { decode } from 'jpeg-js';
import { Image } from 'react-native';

import type { PpOcrRegion } from './types';
import type { PpOcrOrientation } from './orientation';
import { stripWidthForQuad, warpQuadToStrip, type WarpPoint } from './warp';
import type { PpOcrTensorPreprocessOptions } from './profile';

export type DecodedJpeg = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

export type DetectorImage = DecodedJpeg & {
  sourceWidth: number;
  sourceHeight: number;
};

const DEFAULT_TENSOR_PREPROCESS: PpOcrTensorPreprocessOptions = {
  illuminationNormalization: false,
};

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

async function manipulateToJpeg(uri: string, actions: Action[]) {
  const result = await manipulateAsync(uri, actions, {
    base64: true,
    compress: 0.95,
    format: SaveFormat.JPEG,
  });
  if (!result.base64) throw new Error('Unable to encode receipt image.');
  const decoded = decode(toByteArray(result.base64), {
    useTArray: true,
    formatAsRGBA: true,
  });
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: decoded.data,
  } satisfies DecodedJpeg;
}

export async function prepareOrientationVariantUri(
  uri: string,
  orientation: PpOcrOrientation,
): Promise<string> {
  if (orientation === 0) return uri;
  const result = await manipulateAsync(uri, [{ rotate: orientation }], {
    compress: 0.95,
    format: SaveFormat.JPEG,
  });
  return result.uri;
}

export async function prepareDetectorImage(
  uri: string,
  maxSide = 960,
): Promise<DetectorImage> {
  const original = await imageSize(uri);
  const scale = Math.min(
    1,
    maxSide / Math.max(original.width, original.height),
  );
  const width = Math.max(32, Math.ceil((original.width * scale) / 32) * 32);
  const height = Math.max(32, Math.ceil((original.height * scale) / 32) * 32);
  return {
    ...(await manipulateToJpeg(uri, [{ resize: { width, height } }])),
    sourceWidth: original.width,
    sourceHeight: original.height,
  };
}

export async function prepareRecognitionCrop(
  uri: string,
  region: PpOcrRegion,
  targetHeight = 48,
  targetWidth = 320,
): Promise<DecodedJpeg> {
  const box = region.boundingBox;
  const originX = Math.max(0, Math.floor(box.x));
  const originY = Math.max(0, Math.floor(box.y));
  const cropWidth = Math.max(1, Math.round(box.width));
  const cropHeight = Math.max(1, Math.round(box.height));
  // 방향성 사각형을 포함하는 축정렬 영역만 네이티브로 잘라 디코드(전체 디코드 비용 회피).
  const cropped = await manipulateToJpeg(uri, [
    { crop: { originX, originY, width: cropWidth, height: cropHeight } },
  ]);
  // 크롭 좌표계 기준의 사각형 꼭짓점(dbPostprocess가 TL, TR, BR, BL 순서로 제공).
  const quad = region.cornerPoints.map((point) => ({
    x: point.x - originX,
    y: point.y - originY,
  })) as [WarpPoint, WarpPoint, WarpPoint, WarpPoint];
  const width = stripWidthForQuad(quad, targetHeight, targetWidth);
  // 방향성 사각형을 원근보정해 인식기용 정규 수평 스트립으로 편다(축정렬 크롭 대비 왜곡 제거).
  return warpQuadToStrip(cropped, quad, width, targetHeight);
}

function illuminationStats(image: DecodedJpeg) {
  const pixels = image.width * image.height;
  let sum = 0;
  let sumSquares = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const rgba = pixel * 4;
    const luminance =
      (image.rgba[rgba] * 0.299 +
        image.rgba[rgba + 1] * 0.587 +
        image.rgba[rgba + 2] * 0.114) /
      255;
    sum += luminance;
    sumSquares += luminance * luminance;
  }
  const mean = pixels ? sum / pixels : 0.5;
  const variance = Math.max(0, pixels ? sumSquares / pixels - mean * mean : 0);
  const std = Math.sqrt(variance);
  return {
    mean,
    scale: Math.min(1.45, Math.max(1, 0.26 / Math.max(0.08, std))),
  };
}

function normalizedChannel(
  value: number,
  stats: ReturnType<typeof illuminationStats> | undefined,
) {
  const normalized = value / 255;
  if (!stats) return normalized;
  return Math.max(
    0,
    Math.min(1, (normalized - stats.mean) * stats.scale + 0.55),
  );
}

export function detectorTensorData(
  image: DecodedJpeg,
  options: PpOcrTensorPreprocessOptions = DEFAULT_TENSOR_PREPROCESS,
): Float32Array {
  const stats = options.illuminationNormalization
    ? illuminationStats(image)
    : undefined;
  const plane = image.width * image.height;
  const values = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const rgba = pixel * 4;
    values[pixel] = (normalizedChannel(image.rgba[rgba], stats) - 0.485) / 0.229;
    values[plane + pixel] =
      (normalizedChannel(image.rgba[rgba + 1], stats) - 0.456) / 0.224;
    values[plane * 2 + pixel] =
      (normalizedChannel(image.rgba[rgba + 2], stats) - 0.406) / 0.225;
  }
  return values;
}

export function recognizerTensorData(
  image: DecodedJpeg,
  targetWidth = 320,
  options: PpOcrTensorPreprocessOptions = DEFAULT_TENSOR_PREPROCESS,
): Float32Array {
  const stats = options.illuminationNormalization
    ? illuminationStats(image)
    : undefined;
  const plane = targetWidth * image.height;
  const values = new Float32Array(plane * 3);
  values.fill(1);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const target = y * targetWidth + x;
      values[target] = normalizedChannel(image.rgba[source], stats) * 2 - 1;
      values[plane + target] =
        normalizedChannel(image.rgba[source + 1], stats) * 2 - 1;
      values[plane * 2 + target] =
        normalizedChannel(image.rgba[source + 2], stats) * 2 - 1;
    }
  }
  return values;
}
