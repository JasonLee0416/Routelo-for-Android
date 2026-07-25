import * as FileSystem from 'expo-file-system/legacy';
import { toByteArray } from 'base64-js';
import {
  manipulateAsync,
  SaveFormat,
  type ImageResult,
} from 'expo-image-manipulator';
import { decode } from 'jpeg-js';

import type { CaptureQuality } from '../models';
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
const QUALITY_ANALYSIS_LONG_SIDE = 720;

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

const percent = (value: number) => Math.round(clamp(value));

function rgbToHsvSaturation(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max === 0 ? 0 : (max - min) / max;
}

function nearestAxisAngle(degrees: number) {
  const normalized = Math.abs(degrees) % 90;
  return Math.min(normalized, 90 - normalized);
}

export const BRIGHTNESS_IDEAL = 0.66;

// 문서는 흰 배경 비중이 커서 평균 밝기(mean)가 이상값보다 높은 게 정상이며,
// 이는 과노출이 아니다. 어두운 쪽(mean < ideal)은 글자 대비를 직접 떨어뜨려
// 인식을 해치므로 강하게, 밝은 쪽은 약하게 감점한다. 완전 흰 픽셀(blownRatio)도
// 흰 배경 문서에선 자연스러우므로 관대하게 둔다. (스캔/캡처 문서가 밝기 게이트에
// 잘못 막혀 갤러리 OCR이 시작조차 안 되던 문제 — #122)
export function scoreBrightness(
  mean: number,
  darkRatio: number,
  blownRatio: number,
) {
  const deviation =
    mean < BRIGHTNESS_IDEAL
      ? (BRIGHTNESS_IDEAL - mean) * 150
      : (mean - BRIGHTNESS_IDEAL) * 55;
  return percent(100 - deviation - darkRatio * 65 - blownRatio * 20);
}

function scoreSharpness(laplacianVariance: number) {
  return percent(Math.log10(laplacianVariance + 1) * 34);
}

function scoreShadow(tileStd: number) {
  return percent(100 - tileStd * 185);
}

function scoreSkew(skewDegrees: number | undefined) {
  if (skewDegrees === undefined) return 35;
  return percent(100 - nearestAxisAngle(skewDegrees) * 5.5);
}

function scoreCoverage(boxRatio: number, paperRatio: number) {
  if (paperRatio < 0.04) return 20;
  if (boxRatio < 0.22) return percent(boxRatio * 180);
  if (boxRatio > 0.98) return 88;
  return percent(52 + boxRatio * 55);
}

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

async function decodeForQuality(input: ReceiptImageInput) {
  const actions =
    input.width && input.height
      ? [
          {
            resize:
              input.width >= input.height
                ? { width: QUALITY_ANALYSIS_LONG_SIDE }
                : { height: QUALITY_ANALYSIS_LONG_SIDE },
          },
        ]
      : [];
  const result = await manipulateAsync(input.uri, actions, {
    base64: true,
    compress: 0.92,
    format: SaveFormat.JPEG,
  });
  if (!result.base64) throw new Error('Unable to decode receipt image quality.');
  const decoded = decode(toByteArray(result.base64), {
    useTArray: true,
    formatAsRGBA: true,
  });
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: decoded.data,
  };
}

export async function inspectReceiptImageQuality(
  input: ReceiptImageInput,
): Promise<CaptureQuality> {
  const fallback = inspectCaptureQuality(input);
  try {
    const image = await decodeForQuality(input);
    const pixels = image.width * image.height;
    const luminance = new Float32Array(pixels);
    let sum = 0;
    let sumSquares = 0;
    let darkPixels = 0;
    let blownPixels = 0;
    let paperPixels = 0;
    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
    let paperSumX = 0;
    let paperSumY = 0;
    let paperSumXX = 0;
    let paperSumYY = 0;
    let paperSumXY = 0;

    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const rgba = pixel * 4;
      const red = image.rgba[rgba];
      const green = image.rgba[rgba + 1];
      const blue = image.rgba[rgba + 2];
      const y = Math.floor(pixel / image.width);
      const x = pixel - y * image.width;
      const lum = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
      const saturation = rgbToHsvSaturation(red, green, blue);
      luminance[pixel] = lum;
      sum += lum;
      sumSquares += lum * lum;
      if (lum < 0.18) darkPixels += 1;
      if (lum > 0.94) blownPixels += 1;

      const paperLike = lum > 0.48 && saturation < 0.42;
      if (paperLike) {
        paperPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        paperSumX += x;
        paperSumY += y;
        paperSumXX += x * x;
        paperSumYY += y * y;
        paperSumXY += x * y;
      }
    }

    const mean = pixels ? sum / pixels : 0;
    const variance = Math.max(0, pixels ? sumSquares / pixels - mean * mean : 0);
    let laplacianSum = 0;
    let laplacianSquares = 0;
    let laplacianCount = 0;
    for (let y = 1; y < image.height - 1; y += 1) {
      for (let x = 1; x < image.width - 1; x += 1) {
        const center = luminance[y * image.width + x];
        const laplacian =
          luminance[(y - 1) * image.width + x] +
          luminance[(y + 1) * image.width + x] +
          luminance[y * image.width + x - 1] +
          luminance[y * image.width + x + 1] -
          center * 4;
        laplacianSum += laplacian;
        laplacianSquares += laplacian * laplacian;
        laplacianCount += 1;
      }
    }
    const laplacianMean = laplacianCount ? laplacianSum / laplacianCount : 0;
    const laplacianVariance = Math.max(
      0,
      laplacianCount ? laplacianSquares / laplacianCount - laplacianMean ** 2 : 0,
    ) * 255 * 255;

    const hasPaper = paperPixels > pixels * 0.035 && maxX >= minX && maxY >= minY;
    const boxRatio = hasPaper
      ? ((maxX - minX + 1) * (maxY - minY + 1)) / pixels
      : 0;
    const paperRatio = paperPixels / Math.max(1, pixels);

    let skewDegrees: number | undefined;
    if (hasPaper) {
      const cx = paperSumX / paperPixels;
      const cy = paperSumY / paperPixels;
      const covXX = paperSumXX / paperPixels - cx * cx;
      const covYY = paperSumYY / paperPixels - cy * cy;
      const covXY = paperSumXY / paperPixels - cx * cy;
      skewDegrees = (0.5 * Math.atan2(2 * covXY, covXX - covYY) * 180) / Math.PI;
    }

    const tileMeans: number[] = [];
    const columns = 6;
    const rows = 8;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        let tileSum = 0;
        let tileCount = 0;
        const startX = Math.floor((column * image.width) / columns);
        const endX = Math.floor(((column + 1) * image.width) / columns);
        const startY = Math.floor((row * image.height) / rows);
        const endY = Math.floor(((row + 1) * image.height) / rows);
        for (let y = startY; y < endY; y += 1) {
          for (let x = startX; x < endX; x += 1) {
            const lum = luminance[y * image.width + x];
            if (lum > 0.42) {
              tileSum += lum;
              tileCount += 1;
            }
          }
        }
        if (tileCount > 20) tileMeans.push(tileSum / tileCount);
      }
    }
    const tileMean = tileMeans.length
      ? tileMeans.reduce((total, value) => total + value, 0) / tileMeans.length
      : mean;
    const tileStd = Math.sqrt(
      tileMeans.length
        ? tileMeans.reduce((total, value) => total + (value - tileMean) ** 2, 0) /
            tileMeans.length
        : variance,
    );

    const brightness = scoreBrightness(
      mean,
      darkPixels / Math.max(1, pixels),
      blownPixels / Math.max(1, pixels),
    );
    const blur = scoreSharpness(laplacianVariance);
    const documentCoverage = scoreCoverage(boxRatio, paperRatio);
    const shadow = scoreShadow(tileStd);
    const skew = scoreSkew(skewDegrees);
    const resolutionScore = percent(
      (Math.min(input.width || image.width, input.height || image.height) /
        OCR_MIN_SHORT_SIDE) *
        100,
    );
    const score = Math.round(
      blur * 0.27 +
        brightness * 0.22 +
        documentCoverage * 0.23 +
        skew * 0.12 +
        shadow * 0.16,
    );
    const messages: string[] = [];
    if (resolutionScore < 72) {
      messages.push('실측 해상도가 낮습니다. 인수증 글자가 더 크게 보이도록 가까이 촬영하세요.');
    }
    if (blur < 55) {
      messages.push('실측 선명도가 낮습니다. 흔들림을 줄이고 초점을 다시 맞춰주세요.');
    }
    if (brightness < 55) {
      messages.push(
        mean > BRIGHTNESS_IDEAL
          ? '화면 반사·과노출로 글자가 날아갑니다. 조명 반사를 줄이거나 각도를 바꿔 촬영하세요.'
          : '실측 밝기가 낮습니다. 그림자를 피하고 더 밝은 곳에서 촬영하세요.',
      );
    }
    if (documentCoverage < 58) {
      messages.push('인수증 종이 영역이 충분히 크게 잡히지 않았습니다. 화면을 더 꽉 채워주세요.');
    }
    if (shadow < 55) {
      messages.push('종이 위 밝기 편차가 큽니다. 그림자나 반사를 줄여주세요.');
    }
    if (skew < 55) {
      messages.push('인수증이 많이 기울어져 보입니다. 화면과 평행하게 맞춰주세요.');
    }

    return {
      score,
      blur,
      brightness,
      documentCoverage,
      skew,
      shadow,
      passed:
        score >= 68 &&
        blur >= 50 &&
        brightness >= 50 &&
        documentCoverage >= 50,
      messages,
      measured: true,
      metrics: {
        width: input.width,
        height: input.height,
        luminanceMean: Number(mean.toFixed(3)),
        luminanceStd: Number(Math.sqrt(variance).toFixed(3)),
        sharpnessVariance: Number(laplacianVariance.toFixed(2)),
        paperPixelRatio: Number(paperRatio.toFixed(3)),
        documentBoxRatio: Number(boxRatio.toFixed(3)),
        shadowTileStd: Number(tileStd.toFixed(3)),
        skewDegrees:
          skewDegrees === undefined ? undefined : Number(skewDegrees.toFixed(1)),
      },
    };
  } catch (error) {
    return {
      ...fallback,
      measured: false,
      messages: [
        ...fallback.messages,
        error instanceof Error
          ? `실측 품질 분석 실패: ${error.message}`
          : '실측 품질 분석에 실패해 품질 점수를 제공하지 않습니다.',
      ],
    };
  }
}

export async function prepareReceiptImageForOcr(
  input: ReceiptImageInput,
): Promise<PreparedReceiptImage> {
  const action = resizeAction(input.width, input.height);
  const preparationMessages: string[] = [];
  if (Math.min(input.width || 0, input.height || 0) < OCR_MIN_SHORT_SIDE) {
    preparationMessages.push(
      'OCR 입력 이미지의 짧은 변이 작습니다. 인수증을 더 가까이, 흔들림 없이 촬영해야 합니다.',
    );
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
