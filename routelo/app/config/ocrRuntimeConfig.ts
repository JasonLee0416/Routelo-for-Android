export type OcrPrimaryEngine = 'ppocrv5' | 'android-korean-text';

// 주 엔진 결정의 단일 진실. config와 recognizer 게이트가 이 함수를 공유해
// drift를 막는다. 기본은 온디바이스 한국어 엔진, PP-OCR은 명시 opt-in
// (docs/ocr-benchmark/2026-07-25-device-engine-verification.md).
export function resolvePrimaryEngine(engineEnv?: string): OcrPrimaryEngine {
  return engineEnv === 'ppocrv5' ? 'ppocrv5' : 'android-korean-text';
}

type OcrRuntimeEnv = {
  EXPO_PUBLIC_ROUTELO_OCR_PROFILE?: string;
  EXPO_PUBLIC_ROUTELO_OCR_ENGINE?: string;
  EXPO_PUBLIC_ROUTELO_OCR_DIAGNOSTICS?: string;
};

declare const process:
  | {
      env?: OcrRuntimeEnv;
    }
  | undefined;

const currentEnv =
  typeof process !== 'undefined'
    ? process.env ?? {}
    : (globalThis as { process?: { env?: OcrRuntimeEnv } }).process?.env ?? {};
const directProfile =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_ROUTELO_OCR_PROFILE : undefined;
const directEngine =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_ROUTELO_OCR_ENGINE : undefined;
const directDiagnostics =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_ROUTELO_OCR_DIAGNOSTICS : undefined;

const profile = directProfile || currentEnv.EXPO_PUBLIC_ROUTELO_OCR_PROFILE || 'stable-mobile';
const primaryEngine = resolvePrimaryEngine(
  directEngine || currentEnv.EXPO_PUBLIC_ROUTELO_OCR_ENGINE,
);
const diagnostics =
  (directDiagnostics || currentEnv.EXPO_PUBLIC_ROUTELO_OCR_DIAGNOSTICS) === '1' ||
  profile === 'ocr-recovery-test';

export const OCR_RUNTIME_CONFIG = {
  profile,
  primaryEngine,
  diagnostics,
  comparePpOcr: diagnostics,
  source: 'expo-public-env-with-safe-fallback',
} as const;

export function ocrRuntimeConfigSummary() {
  return [
    `profile=${OCR_RUNTIME_CONFIG.profile}`,
    `primary=${OCR_RUNTIME_CONFIG.primaryEngine}`,
    `diagnostics=${OCR_RUNTIME_CONFIG.diagnostics ? 'on' : 'off'}`,
    `comparePpOcr=${OCR_RUNTIME_CONFIG.comparePpOcr ? 'on' : 'off'}`,
  ].join(' · ');
}
