export type PpOcrPreprocessProfileId =
  | 'stable-mobile'
  | 'high-res-preprocess';

export type PpOcrTensorPreprocessOptions = {
  illuminationNormalization: boolean;
};

export type PpOcrPreprocessProfile = {
  id: PpOcrPreprocessProfileId;
  detectorMaxSide: number;
  recognizerTargetHeight: number;
  recognizerTargetWidth: number;
  minLineConfidence: number;
  tensor: PpOcrTensorPreprocessOptions;
};

export const PP_OCR_PREPROCESS_PROFILES = {
  stableMobile: {
    id: 'stable-mobile',
    detectorMaxSide: 960,
    recognizerTargetHeight: 48,
    recognizerTargetWidth: 320,
    minLineConfidence: 0.35,
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
  return env?.EXPO_PUBLIC_ROUTELO_OCR_PROFILE === 'high-res-preprocess'
    ? PP_OCR_PREPROCESS_PROFILES.highResPreprocess
    : PP_OCR_PREPROCESS_PROFILES.stableMobile;
}
