process.env.EXPO_PUBLIC_ROUTELO_OCR_PROFILE =
  process.env.EXPO_PUBLIC_ROUTELO_OCR_PROFILE || 'ocr-recovery-test';
process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE =
  process.env.EXPO_PUBLIC_ROUTELO_OCR_ENGINE || 'android-korean-text';
process.env.ROUTELO_APK_KIND = process.env.ROUTELO_APK_KIND || 'standalone-release';

await import('./build-android-standalone.mjs');
