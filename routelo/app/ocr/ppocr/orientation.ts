import type { PpOcrLine, PpOcrRegion } from './types';

export const PP_OCR_ORIENTATION_CANDIDATES = [0, 90, 180, 270] as const;

export type PpOcrOrientation = (typeof PP_OCR_ORIENTATION_CANDIDATES)[number];

export type PpOcrOrientationCandidate = {
  orientation: PpOcrOrientation;
  lines: PpOcrLine[];
  regions: PpOcrRegion[];
  processingMs: number;
};

export type PpOcrOrientationScore = {
  orientation: PpOcrOrientation;
  score: number;
  lineCount: number;
  averageConfidence: number;
  averageRegionScore: number;
  meaningfulTextLength: number;
};

const meaningfulText = (lines: PpOcrLine[]) =>
  lines
    .map((line) => line.text)
    .join('')
    .replace(/[^\p{L}\p{N}]+/gu, '');

export function scoreOrientationCandidate(
  candidate: PpOcrOrientationCandidate,
): PpOcrOrientationScore {
  const lineCount = candidate.lines.length;
  const averageConfidence = lineCount
    ? candidate.lines.reduce((sum, line) => sum + line.confidence, 0) / lineCount
    : 0;
  const averageRegionScore = candidate.regions.length
    ? candidate.regions.reduce((sum, region) => sum + region.score, 0) /
      candidate.regions.length
    : 0;
  const meaningfulTextLength = meaningfulText(candidate.lines).length;

  return {
    orientation: candidate.orientation,
    lineCount,
    averageConfidence,
    averageRegionScore,
    meaningfulTextLength,
    score:
      lineCount * 5 +
      meaningfulTextLength * 0.8 +
      averageConfidence * 12 +
      averageRegionScore * 4,
  };
}

export function isGoodOrientationCandidate(
  candidate: PpOcrOrientationCandidate,
) {
  const score = scoreOrientationCandidate(candidate);
  return (
    score.lineCount >= 6 &&
    score.meaningfulTextLength >= 28 &&
    score.averageConfidence >= 0.45
  );
}

export function chooseBestOrientationCandidate<
  T extends PpOcrOrientationCandidate,
>(candidates: T[]): T {
  if (!candidates.length) {
    throw new Error('At least one PP-OCR orientation candidate is required.');
  }
  return [...candidates].sort((left, right) => {
    const leftScore = scoreOrientationCandidate(left);
    const rightScore = scoreOrientationCandidate(right);
    return (
      rightScore.score - leftScore.score ||
      rightScore.lineCount - leftScore.lineCount ||
      rightScore.meaningfulTextLength - leftScore.meaningfulTextLength
    );
  })[0];
}
