import { Platform } from 'react-native';

import type {
  CaptureQuality,
  OcrFieldKey,
  OcrPipelineResult,
} from '../models';
import {
  ANDROID_KOREAN_TEXT_MODEL_VERSION,
  recognizeReceiptWithAndroidKoreanText,
} from '../platform/androidKoreanTextRecognizer';
import { PP_OCR_MODEL_VERSION } from '../ocr/ppocr/modelManifest';
import {
  OcrNoTextDetectedError,
  OcrRecognizerUnavailableError,
  runReceiptOcr,
} from './ocr';

export type OcrDiagnosticCandidateId = 'ppocrv5' | 'mlkit-v2-korean';

type RecognizedTextForDiagnostics = {
  engine?: OcrPipelineResult['engine'];
  modelVersion?: string;
  fullText: string;
  processingMs: number;
  diagnostics?: OcrPipelineResult['ocrDiagnostics'];
  lines?: NonNullable<OcrPipelineResult['recognizedLines']>;
};

export type OcrDiagnosticCandidateConfig = {
  id: OcrDiagnosticCandidateId;
  label: string;
  modelVersion: string;
  available: boolean;
  reason?: string;
  recognizeImage: (imageUri: string) => Promise<RecognizedTextForDiagnostics>;
};

export type OcrDiagnosticCandidateStatus =
  | 'success'
  | 'no-text'
  | 'unavailable'
  | 'error'
  | 'skipped';

export type OcrDiagnosticCandidateResult = {
  id: OcrDiagnosticCandidateId;
  label: string;
  status: OcrDiagnosticCandidateStatus;
  engine?: OcrPipelineResult['engine'];
  modelVersion?: string;
  processingMs: number;
  rawTextLength: number;
  rawTextPreview: string;
  lineCount: number;
  populatedFieldCount: number;
  requiredFieldCount: number;
  missingRequiredKeys: OcrFieldKey[];
  documentConfidence?: number;
  diagnostics?: OcrPipelineResult['ocrDiagnostics'];
  errorMessage?: string;
  result?: OcrPipelineResult;
};

export type OcrDiagnosticComparisonReport = {
  image: {
    uri?: string;
    originalUri?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    normalized?: boolean;
  };
  quality: {
    measured: boolean;
    passed: boolean;
    score: number;
    width?: number;
    height?: number;
  };
  candidates: OcrDiagnosticCandidateResult[];
  bestCandidateId?: OcrDiagnosticCandidateId;
  decision: 'use-best-candidate' | 'manual-review-required';
};

type ImageInput = {
  uri?: string;
  originalUri?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  normalized?: boolean;
};

type RouteloEnv = {
  EXPO_PUBLIC_ROUTELO_OCR_DIAGNOSTICS?: string;
  EXPO_PUBLIC_ROUTELO_OCR_PROFILE?: string;
};

const runtimeEnv = () =>
  (globalThis as { process?: { env?: RouteloEnv } }).process?.env;

export function ocrDiagnosticComparisonEnabled(
  env: RouteloEnv | undefined = runtimeEnv(),
) {
  return (
    env?.EXPO_PUBLIC_ROUTELO_OCR_DIAGNOSTICS === '1' ||
    env?.EXPO_PUBLIC_ROUTELO_OCR_PROFILE === 'ocr-recovery-test'
  );
}

const previewText = (value: string, limit = 160) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
};

const missingRequiredKeys = (result: OcrPipelineResult | undefined) =>
  result?.fields
    .filter((field) => field.required && !field.value.trim())
    .map((field) => field.key) ?? [];

const populatedFieldCount = (result: OcrPipelineResult | undefined) =>
  result?.fields.filter((field) => field.value.trim()).length ?? 0;

const requiredFieldCount = (result: OcrPipelineResult | undefined) =>
  result?.fields.filter((field) => field.required).length ?? 0;

export function createDefaultOcrDiagnosticCandidates(
  platform: typeof Platform.OS = Platform.OS,
): OcrDiagnosticCandidateConfig[] {
  return [
    {
      id: 'ppocrv5',
      label: 'PP-OCRv5 local',
      modelVersion: PP_OCR_MODEL_VERSION,
      available: platform === 'android' || platform === 'ios',
      reason:
        platform === 'android' || platform === 'ios'
          ? undefined
          : `PP-OCR is unavailable on ${platform}.`,
      async recognizeImage(imageUri) {
        const { recognizeReceiptWithPpOcr } = await import('../ocr/ppocr/runtime');
        return recognizeReceiptWithPpOcr(imageUri);
      },
    },
    {
      id: 'mlkit-v2-korean',
      label: 'Android Korean Text OCR',
      modelVersion: ANDROID_KOREAN_TEXT_MODEL_VERSION,
      available: platform === 'android',
      reason:
        platform === 'android'
          ? undefined
          : 'Android Korean Text OCR is available only on Android builds.',
      recognizeImage: recognizeReceiptWithAndroidKoreanText,
    },
  ];
}

async function runCandidate(
  image: ImageInput,
  quality: CaptureQuality,
  candidate: OcrDiagnosticCandidateConfig,
): Promise<OcrDiagnosticCandidateResult> {
  const startedAt = Date.now();
  if (!candidate.available) {
    return {
      id: candidate.id,
      label: candidate.label,
      status: 'skipped',
      modelVersion: candidate.modelVersion,
      processingMs: 0,
      rawTextLength: 0,
      rawTextPreview: '',
      lineCount: 0,
      populatedFieldCount: 0,
      requiredFieldCount: 0,
      missingRequiredKeys: [],
      errorMessage: candidate.reason,
    };
  }

  if (!image.uri?.trim()) {
    return {
      id: candidate.id,
      label: candidate.label,
      status: 'unavailable',
      modelVersion: candidate.modelVersion,
      processingMs: 0,
      rawTextLength: 0,
      rawTextPreview: '',
      lineCount: 0,
      populatedFieldCount: 0,
      requiredFieldCount: 0,
      missingRequiredKeys: [],
      errorMessage: 'No prepared receipt image URI is available.',
    };
  }

  let recognized: RecognizedTextForDiagnostics | undefined;
  try {
    recognized = await candidate.recognizeImage(image.uri);
    const result = await runReceiptOcr(
      image,
      undefined,
      async () => recognized as RecognizedTextForDiagnostics,
      quality,
    );
    return {
      id: candidate.id,
      label: candidate.label,
      status: 'success',
      engine: result.engine,
      modelVersion: result.modelVersion ?? candidate.modelVersion,
      processingMs: result.processingMs || Date.now() - startedAt,
      rawTextLength: result.rawText.length,
      rawTextPreview: previewText(result.rawText),
      lineCount: result.recognizedLines?.length ?? recognized.lines?.length ?? 0,
      populatedFieldCount: populatedFieldCount(result),
      requiredFieldCount: requiredFieldCount(result),
      missingRequiredKeys: missingRequiredKeys(result),
      documentConfidence: result.documentConfidence,
      diagnostics: result.ocrDiagnostics ?? recognized.diagnostics,
      result,
    };
  } catch (error) {
    const status =
      error instanceof OcrNoTextDetectedError
        ? 'no-text'
        : error instanceof OcrRecognizerUnavailableError
          ? 'unavailable'
          : 'error';
    return {
      id: candidate.id,
      label: candidate.label,
      status,
      engine: recognized?.engine,
      modelVersion: recognized?.modelVersion ?? candidate.modelVersion,
      processingMs: recognized?.processingMs ?? Date.now() - startedAt,
      rawTextLength: recognized?.fullText.length ?? 0,
      rawTextPreview: previewText(recognized?.fullText ?? ''),
      lineCount: recognized?.lines?.length ?? 0,
      populatedFieldCount: 0,
      requiredFieldCount: 0,
      missingRequiredKeys: [],
      diagnostics: recognized?.diagnostics,
      errorMessage:
        error instanceof Error ? error.message : 'OCR candidate failed.',
    };
  }
}

export function selectBestOcrDiagnosticCandidate(
  candidates: OcrDiagnosticCandidateResult[],
) {
  const successful = candidates.filter(
    (candidate) => candidate.status === 'success' && candidate.result,
  );
  if (!successful.length) return undefined;
  return [...successful].sort((left, right) => {
    const fieldDelta = right.populatedFieldCount - left.populatedFieldCount;
    if (fieldDelta) return fieldDelta;
    const confidenceDelta =
      (right.documentConfidence ?? 0) - (left.documentConfidence ?? 0);
    if (confidenceDelta) return confidenceDelta;
    return right.rawTextLength - left.rawTextLength;
  })[0];
}

export async function runOcrDiagnosticComparison(
  image: ImageInput,
  quality: CaptureQuality,
  options: {
    platform?: typeof Platform.OS;
    candidates?: OcrDiagnosticCandidateConfig[];
  } = {},
): Promise<OcrDiagnosticComparisonReport> {
  const candidates =
    options.candidates ??
    createDefaultOcrDiagnosticCandidates(options.platform ?? Platform.OS);
  const results: OcrDiagnosticCandidateResult[] = [];
  for (const candidate of candidates) {
    results.push(await runCandidate(image, quality, candidate));
  }
  const best = selectBestOcrDiagnosticCandidate(results);
  return {
    image: {
      uri: image.uri,
      originalUri: image.originalUri,
      width: image.width,
      height: image.height,
      fileSize: image.fileSize,
      normalized: image.normalized,
    },
    quality: {
      measured: Boolean(quality.measured),
      passed: quality.passed,
      score: quality.score,
      width: quality.metrics?.width ?? image.width,
      height: quality.metrics?.height ?? image.height,
    },
    candidates: results,
    bestCandidateId: best?.id,
    decision: best ? 'use-best-candidate' : 'manual-review-required',
  };
}
