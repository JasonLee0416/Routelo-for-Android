import { resolvePrimaryEngine } from '../ocrRuntimeConfig';

describe('resolvePrimaryEngine', () => {
  it('defaults to the on-device Korean text engine', () => {
    // 기본은 온디바이스 한국어 엔진(실기기 확증: PP-OCR는 no-text).
    expect(resolvePrimaryEngine(undefined)).toBe('android-korean-text');
    expect(resolvePrimaryEngine('')).toBe('android-korean-text');
    expect(resolvePrimaryEngine('android-korean-text')).toBe(
      'android-korean-text',
    );
    // 알 수 없는 값도 안전하게 기본으로.
    expect(resolvePrimaryEngine('garbage')).toBe('android-korean-text');
  });

  it('selects PP-OCR only via explicit opt-in', () => {
    expect(resolvePrimaryEngine('ppocrv5')).toBe('ppocrv5');
  });
});
