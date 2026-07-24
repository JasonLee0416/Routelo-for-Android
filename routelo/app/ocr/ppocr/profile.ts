export type PpOcrPreprocessProfileId =
  | 'stable-mobile'
  | 'high-res-preprocess'
  | 'ocr-recovery-test';

export type PpOcrTensorPreprocessOptions = {
  illuminationNormalization: boolean;
};

export type PpOcrPreprocessProfile = {
  id: PpOcrPreprocessProfileId;
  detectorMaxSide: number;
  recognizerTargetHeight: number;
  recognizerTargetWidth: number;
  minLineConfidence: number;
  dbPostprocess: {
    threshold: number;
    boxThreshold: number;
    minArea: number;
    unclipRatio: number;
    maxRegions: number;
  };
  tensor: PpOcrTensorPreprocessOptions;
};

export const PP_OCR_PREPROCESS_PROFILES = {
  stableMobile: {
    id: 'stable-mobile',
    detectorMaxSide: 960,
    recognizerTargetHeight: 48,
    recognizerTargetWidth: 320,
    minLineConfidence: 0.35,
    dbPostprocess: {
      threshold: 0.3,
      boxThreshold: 0.5,
      minArea: 12,
      unclipRatio: 1.6,
      maxRegions: 96,
    },
    tensor: {
      illuminationNormalization: false,
    },
  },
  highResPreprocess: {
    id: 'high-res-preprocess',
    detectorMaxSide: 1536,
    recognizerTargetHeight: 48,
    recognizerTargetWidth: 480,
    minLineConfidence: 0.48,
    dbPostprocess: {
      threshold: 0.28,
      boxThreshold: 0.42,
      minArea: 10,
      unclipRatio: 1.8,
      maxRegions: 128,
    },
    tensor: {
      illuminationNormalization: true,
    },
  },
  ocrRecoveryTest: {
    id: 'ocr-recovery-test',
    detectorMaxSide: 1920,
    recognizerTargetHeight: 48,
    recognizerTargetWidth: 640,
    minLineConfidence: 0.22,
    dbPostprocess: {
      threshold: 0.18,
      boxThreshold: 0.22,
      minArea: 5,
      unclipRatio: 2.15,
      maxRegions: 192,
    },
    tensor: {
      illuminationNormalization: true,
    },
  },
} as const satisfies Record<string, PpOcrPreprocessProfile>;

type RouteloEnv = {
  EXPO_PUBLIC_ROUTELO_OCR_PROFILE?: string;
};

const runtimeEnv = () =>
  (globalThis as { process?: { env?: RouteloEnv } }).process?.env;

export function selectPpOcrPreprocessProfile(
  env: RouteloEnv | undefined = runtimeEnv(),
): PpOcrPreprocessProfile {
  if (env?.EXPO_PUBLIC_ROUTELO_OCR_PROFILE === 'high-res-preprocess') {
    return PP_OCR_PREPROCESS_PROFILES.highResPreprocess;
  }
  if (env?.EXPO_PUBLIC_ROUTELO_OCR_PROFILE === 'ocr-recovery-test') {
    return PP_OCR_PREPROCESS_PROFILES.ocrRecoveryTest;
  }
  return PP_OCR_PREPROCESS_PROFILES.stableMobile;
}
