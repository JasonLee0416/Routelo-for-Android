import { decodeCtc } from '../ctc';
import { extractDbTextRegions } from '../dbPostprocess';
import {
  chooseBestOrientationCandidate,
  isGoodOrientationCandidate,
  scoreOrientationCandidate,
} from '../orientation';
import type { PpOcrLine } from '../types';

const line = (text: string, confidence: number): PpOcrLine => ({
  text,
  confidence,
  boundingBox: { x: 0, y: 0, width: 100, height: 20 },
  cornerPoints: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 20 },
    { x: 0, y: 20 },
  ],
});

describe('PP-OCR shared core', () => {
  it('decodes CTC blanks and repeated characters with calibrated confidence', () => {
    const logits = new Float32Array([
      10, 0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 0, 0, 10,
    ]);

    const decoded = decodeCtc(logits, 5, 3, ['가', '나']);
    expect(decoded.text).toBe('가나');
    // 신뢰도는 raw 로짓 평균이 아니라 [0,1] softmax 최대확률로 보정된다.
    expect(decoded.confidence).toBeCloseTo(1, 3);
  });

  it('passes through softmax-probability inputs as the max probability', () => {
    // 이미 확률 분포(합=1)인 출력: 스텝별 최대 확률을 그대로 신뢰도로 사용.
    const probs = new Float32Array([0.05, 0.9, 0.05, 0.05, 0.05, 0.9]);
    const decoded = decodeCtc(probs, 2, 3, ['가', '나']);
    expect(decoded.text).toBe('가나');
    expect(decoded.confidence).toBeCloseTo(0.9, 5);
  });

  it('extracts and unclips connected detector regions', () => {
    const map = new Float32Array(8 * 6);
    for (let y = 2; y <= 3; y += 1) {
      for (let x = 2; x <= 5; x += 1) map[y * 8 + x] = 0.9;
    }

    const regions = extractDbTextRegions(map, 8, 6, 80, 60, {
      minArea: 4,
      unclipRatio: 1.5,
    });

    expect(regions).toHaveLength(1);
    expect(regions[0].score).toBeCloseTo(0.9);
    expect(regions[0].boundingBox.width).toBeGreaterThan(40);
    expect(regions[0].cornerPoints).toHaveLength(4);
  });

  it('preserves an oriented box for diagonal detector components', () => {
    const map = new Float32Array(16 * 16);
    for (let step = 0; step < 8; step += 1) {
      const x = 4 + step;
      const y = 4 + step;
      map[y * 16 + x] = 0.92;
      map[y * 16 + x + 1] = 0.9;
    }

    const regions = extractDbTextRegions(map, 16, 16, 160, 160, {
      minArea: 4,
      unclipRatio: 1.2,
    });

    expect(regions).toHaveLength(1);
    const [topLeft, topRight] = regions[0].cornerPoints;
    const angleDegrees =
      (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) /
      Math.PI;
    expect(Math.abs(angleDegrees)).toBeGreaterThan(10);
  });

  it('scores meaningful orientation candidates above empty OCR results', () => {
    const empty = {
      orientation: 0 as const,
      lines: [],
      regions: [],
      processingMs: 30,
    };
    const useful = {
      orientation: 90 as const,
      lines: [
        line('발주처 아뜰리에몽플라워', 0.82),
        line('배달장소 서울 영등포구 공군호텔', 0.78),
        line('전화번호 010-1234-5678', 0.75),
      ],
      regions: [
        {
          score: 0.8,
          boundingBox: { x: 0, y: 0, width: 100, height: 20 },
          cornerPoints: line('', 0).cornerPoints,
        },
        {
          score: 0.7,
          boundingBox: { x: 0, y: 24, width: 160, height: 20 },
          cornerPoints: line('', 0).cornerPoints,
        },
        {
          score: 0.6,
          boundingBox: { x: 0, y: 48, width: 120, height: 20 },
          cornerPoints: line('', 0).cornerPoints,
        },
      ],
      processingMs: 40,
    };

    expect(scoreOrientationCandidate(useful).score).toBeGreaterThan(
      scoreOrientationCandidate(empty).score,
    );
    expect(chooseBestOrientationCandidate([empty, useful])).toBe(useful);
  });

  it('treats strong original-orientation OCR as good enough to skip rotation fallbacks', () => {
    const candidate = {
      orientation: 0 as const,
      lines: [
        line('발주처 아뜰리에몽플라워', 0.82),
        line('품명 축하3단', 0.78),
        line('배달일시 2026년 06월 14일', 0.78),
        line('예식 12시20분', 0.76),
        line('배달장소 서울 영등포구 공군호텔', 0.79),
        line('받는분 신부 선단비', 0.72),
      ],
      regions: [],
      processingMs: 50,
    };

    expect(isGoodOrientationCandidate(candidate)).toBe(true);
  });
});
