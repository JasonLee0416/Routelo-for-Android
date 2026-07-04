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

export type DecodedJpeg = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

export type DetectorImage = DecodedJpeg & {
  sourceWidth: number;
  sourceHeight: number;
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

export function detectorTensorData(image: DecodedJpeg): Float32Array {
  const plane = image.width * image.height;
  const values = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const rgba = pixel * 4;
    values[pixel] = (image.rgba[rgba] / 255 - 0.485) / 0.229;
    values[plane + pixel] = (image.rgba[rgba + 1] / 255 - 0.456) / 0.224;
    values[plane * 2 + pixel] = (image.rgba[rgba + 2] / 255 - 0.406) / 0.225;
  }
  return values;
}

export function recognizerTensorData(
  image: DecodedJpeg,
  targetWidth = 320,
): Float32Array {
  const plane = targetWidth * image.height;
  const values = new Float32Array(plane * 3);
  values.fill(1);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const target = y * targetWidth + x;
      values[target] = image.rgba[source] / 127.5 - 1;
      values[plane + target] = image.rgba[source + 1] / 127.5 - 1;
      values[plane * 2 + target] = image.rgba[source + 2] / 127.5 - 1;
    }
  }
  return values;
}
