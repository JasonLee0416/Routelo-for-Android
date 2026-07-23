import { androidOcrCandidatePolicy } from '../androidOcrCandidatePolicy';

describe('Android OCR candidate policy', () => {
  it('keeps PP-OCR as the only production-enabled local candidate today', () => {
    const candidates = androidOcrCandidatePolicy('android');

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'ppocrv5',
      'mlkit-v2-korean',
      'cloud-consent',
    ]);
    expect(
      candidates.filter((candidate) => candidate.productionEnabled),
    ).toEqual([
      expect.objectContaining({
        id: 'ppocrv5',
        role: 'primary',
      }),
    ]);
    expect(
      candidates.find((candidate) => candidate.id === 'mlkit-v2-korean'),
    ).toEqual(
      expect.objectContaining({
        productionEnabled: false,
        role: 'reference',
      }),
    );
  });

  it('does not advertise Android-only OCR candidates on other platforms', () => {
    expect(androidOcrCandidatePolicy('ios')).toEqual([]);
    expect(androidOcrCandidatePolicy('web')).toEqual([]);
  });
});
