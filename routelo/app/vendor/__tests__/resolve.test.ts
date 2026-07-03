import { DEFAULT_ROUTELO_SETTINGS, RouteloSettings } from '../../settings';
import { vendorDirectoryFor } from '../resolve';

const withVerification = (on: boolean): RouteloSettings => ({
  ...DEFAULT_ROUTELO_SETTINGS,
  ocr: { ...DEFAULT_ROUTELO_SETTINGS.ocr, onlineVendorVerification: on },
});

describe('vendorDirectoryFor', () => {
  const GOOGLE_KEY = 'EXPO_PUBLIC_GOOGLE_PLACES_API_KEY';
  const LEGACY_KAKAO_KEY = 'EXPO_PUBLIC_KAKAO_REST_API_KEY';
  const originalGoogle = process.env[GOOGLE_KEY];
  const originalKakao = process.env[LEGACY_KAKAO_KEY];

  afterEach(() => {
    if (originalGoogle === undefined) delete process.env[GOOGLE_KEY];
    else process.env[GOOGLE_KEY] = originalGoogle;
    if (originalKakao === undefined) delete process.env[LEGACY_KAKAO_KEY];
    else process.env[LEGACY_KAKAO_KEY] = originalKakao;
  });

  it('is disabled when the toggle is OFF, even with a Google key', () => {
    process.env[GOOGLE_KEY] = 'KEY';
    expect(vendorDirectoryFor(withVerification(false)).id).toBe('null');
  });

  it('is disabled when ON but no Google key is present', () => {
    delete process.env[GOOGLE_KEY];
    expect(vendorDirectoryFor(withVerification(true)).id).toBe('null');
  });

  it('uses Google Places when ON and a Google key is present', () => {
    process.env[GOOGLE_KEY] = 'KEY';
    expect(vendorDirectoryFor(withVerification(true)).id).toBe('google-places');
  });

  it('does not use the legacy Kakao key after Google-only roadmap alignment', () => {
    delete process.env[GOOGLE_KEY];
    process.env[LEGACY_KAKAO_KEY] = 'LEGACY';
    expect(vendorDirectoryFor(withVerification(true)).id).toBe('null');
  });
});
