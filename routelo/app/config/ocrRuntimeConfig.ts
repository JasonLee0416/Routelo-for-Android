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
const primaryEngine =
  (directEngine || currentEnv.EXPO_PUBLIC_ROUTELO_OCR_ENGINE) === 'android-korean-text'
    ? 'android-korean-text'
    : 'ppocrv5';
const diagnostics =
  (directDiagnostics || currentEnv.EXPO_PUBLIC_ROUTELO_OCR_DIAGNOSTICS) === '1' ||
  profile === 'ocr-recovery-test';

export const OCR_RUNTIME_CONFIG = {
  profile,
  primaryEngine: profile === 'ocr-recovery-test' ? 'android-korean-text' : primaryEngine,
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
