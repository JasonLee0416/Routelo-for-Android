import { Platform } from 'react-native';

export type AndroidOcrCandidateId =
  | 'ppocrv5'
  | 'mlkit-v2-korean'
  | 'cloud-consent';

export type AndroidOcrCandidate = {
  id: AndroidOcrCandidateId;
  priority: number;
  productionEnabled: boolean;
  role: 'primary' | 'reference' | 'fallback';
  reason: string;
};

export function androidOcrCandidatePolicy(
  platform: typeof Platform.OS = Platform.OS,
): AndroidOcrCandidate[] {
  if (platform !== 'android') return [];
  return [
    {
      id: 'ppocrv5',
      priority: 1,
      productionEnabled: true,
      role: 'primary',
      reason:
        'Bundled on-device PP-OCR remains the default local recognizer, but must fail closed when it cannot produce receipt evidence.',
    },
    {
      id: 'mlkit-v2-korean',
      priority: 2,
      productionEnabled: false,
      role: 'reference',
      reason:
        'Official Android Korean text recognition is kept as a candidate contract until the repository intentionally changes the no-production-reference guard.',
    },
    {
      id: 'cloud-consent',
      priority: 3,
      productionEnabled: false,
      role: 'fallback',
      reason:
        'Cloud OCR can be offered only after explicit user consent because receipt images may contain personal data.',
    },
  ];
}
