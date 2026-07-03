import {
  createGoogleVendorDirectory,
  NULL_VENDOR_DIRECTORY,
  resolveVendorDirectory,
} from '../google';
import { VendorCandidate, VendorDirectory } from '../types';
import { nameSimilarity, phonesMatch, verifyVendor } from '../verify';

const mockDirectory = (candidates: VendorCandidate[]): VendorDirectory => ({
  id: 'mock',
  async search() {
    return candidates;
  },
});

describe('vendor matching helpers', () => {
  it('name similarity is high for near-identical Korean business names and low for unrelated names', () => {
    expect(nameSimilarity('선유꽃화원', '선유꽃화원')).toBeGreaterThan(0.9);
    expect(nameSimilarity('더채플플라워', '정든화원')).toBeLessThan(0.4);
  });

  it('phone match ignores formatting and needs a full match', () => {
    expect(phonesMatch('010-5898-9543', '01058989543')).toBe(true);
    expect(phonesMatch('010-5898-9543', '02-841-9861')).toBe(false);
    expect(phonesMatch(undefined, '0105')).toBe(false);
  });
});

describe('verifyVendor', () => {
  it('confirms on phone match even with a noisy name', async () => {
    const dir = mockDirectory([
      { name: '더채플플라워 의정부점', phone: '010-5898-9543' },
      { name: '다른 꽃집', phone: '02-111-2222' },
    ]);
    const verification = await verifyVendor(dir, '더채플', {
      ocrPhone: '010 5898 9543',
    });
    expect(verification.status).toBe('confirmed');
    expect(verification.phoneMatched).toBe(true);
    expect(verification.best?.name).toBe('더채플플라워 의정부점');
  });

  it('confirms on a strong name match without phone', async () => {
    const dir = mockDirectory([
      { name: '선유꽃화원', address: '서울 영등포구' },
    ]);
    const verification = await verifyVendor(dir, '선유꽃화원');
    expect(verification.status).toBe('confirmed');
    expect(verification.phoneMatched).toBe(false);
  });

  it('returns ambiguous candidates for a weak match', async () => {
    const dir = mockDirectory([
      { name: '플라워하우스' },
      { name: '플라워가든' },
    ]);
    const verification = await verifyVendor(dir, '플라워');
    expect(verification.status).toBe('ambiguous');
    expect(verification.candidates).toHaveLength(2);
  });

  it('returns notFound when search returns nothing', async () => {
    const verification = await verifyVendor(mockDirectory([]), '없는화원');
    expect(verification.status).toBe('notFound');
  });

  it('skips when directory is the null fallback', async () => {
    const verification = await verifyVendor(NULL_VENDOR_DIRECTORY, '선유꽃화원');
    expect(verification.status).toBe('skipped');
  });
});

describe('Google provider resolution and request shape', () => {
  it('resolveVendorDirectory returns null fallback without a key', () => {
    expect(resolveVendorDirectory().id).toBe('null');
    expect(resolveVendorDirectory({ googlePlacesApiKey: '' }).id).toBe('null');
    expect(resolveVendorDirectory({ googlePlacesApiKey: 'abc' }).id).toBe(
      'google-places',
    );
  });

  it('sends only the sanitized text query and API key header', async () => {
    let sentUrl = '';
    let sentKey = '';
    let sentBody = '';
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sentUrl = String(url);
      sentKey = String((init?.headers as Record<string, string>)?.['X-Goog-Api-Key']);
      sentBody = String(init?.body);
      return {
        ok: true,
        json: async () => ({
          places: [
            {
              displayName: { text: '선유꽃화원' },
              nationalPhoneNumber: '02-1234-5678',
              formattedAddress: '서울 영등포구',
              location: { latitude: 37.5, longitude: 126.9 },
              googleMapsUri: 'https://maps.google.com/?cid=1',
            },
          ],
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const dir = createGoogleVendorDirectory({ apiKey: 'KEY', fetchImpl });
    const result = await dir.search('선유꽃화원');

    expect(sentUrl).toContain('places.googleapis.com');
    expect(sentKey).toBe('KEY');
    expect(sentBody).toContain('선유꽃화원');
    expect(sentBody).not.toMatch(/01[016789]/);
    expect(result[0].name).toBe('선유꽃화원');
    expect(result[0].latitude).toBeCloseTo(37.5);
    expect(result[0].longitude).toBeCloseTo(126.9);
  });
});
