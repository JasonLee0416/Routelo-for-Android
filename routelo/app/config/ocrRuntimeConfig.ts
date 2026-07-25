export type OcrPrimaryEngine = 'ppocrv5' | 'android-korean-text';

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
// 기본 주 엔진은 android-korean-text(온디바이스 한국어 텍스트 인식)다.
// 근거 — 실기기 확증(2026-07-25, docs/ocr-benchmark/2026-07-25-device-engine-verification.md):
// 같은 골든셋 인수증에서 PP-OCR local은 0필드(no-text, text=45 깨짐), 온디바이스
// 한국어 엔진은 6필드(success, text=405). 실기기 네이티브 전처리 경로에서 PP-OCR이
// 텍스트를 못 뽑으므로 사용자가 겪는 인식은 온디바이스 한국어 엔진이 담당해야 한다.
// PP-OCR을 주 엔진으로 강제하려면 EXPO_PUBLIC_ROUTELO_OCR_ENGINE=ppocrv5로 opt-in.
const primaryEngine =
  (directEngine || currentEnv.EXPO_PUBLIC_ROUTELO_OCR_ENGINE) === 'ppocrv5'
    ? 'ppocrv5'
    : 'android-korean-text';
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
