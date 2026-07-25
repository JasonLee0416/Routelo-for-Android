import { OcrPipelineResult } from '../../models';
import {
  applySpatialOcrFieldHeuristics,
  extractSpatialFieldCandidates,
} from '../ocrSpatialHeuristics';

const quality = {
  score: 80,
  blur: 80,
  brightness: 80,
  documentCoverage: 80,
  skew: 80,
  shadow: 80,
  passed: true,
  messages: [],
};

function emptyPipeline(): OcrPipelineResult {
  return {
    engine: 'fixture',
    rawText: '',
    fields: [
      {
        key: 'productName',
        label: '상품명',
        value: '',
        confidence: 0,
        required: true,
        sourceText: '',
        alternatives: [],
        status: 'missing',
      },
      {
        key: 'deliveryDate',
        label: '배송 날짜',
        value: '',
        confidence: 0,
        required: true,
        sourceText: '',
        alternatives: [],
        status: 'missing',
      },
      {
        key: 'deliveryAddress',
        label: '배송 주소',
        value: '',
        confidence: 0,
        required: true,
        sourceText: '',
        alternatives: [],
        status: 'missing',
      },
    ],
    documentConfidence: 0,
    quality,
    processingMs: 0,
    variantsCompared: 1,
    unmapped: [],
  };
}

describe('OCR spatial field heuristics', () => {
  it('recovers table values near label anchors', () => {
    const lines = [
      {
        text: '품명',
        boundingBox: { x: 520, y: 900, width: 140, height: 70 },
      },
      {
        text: '축하화환 3단',
        boundingBox: { x: 820, y: 895, width: 420, height: 75 },
      },
      {
        text: '배달일시',
        boundingBox: { x: 500, y: 1030, width: 220, height: 75 },
      },
      {
        text: '2026년 06월 14일 예식 12시20분',
        boundingBox: { x: 830, y: 1025, width: 900, height: 80 },
      },
      {
        text: '배달장소',
        boundingBox: { x: 500, y: 1200, width: 220, height: 75 },
      },
      {
        text: '서울 영등포구 가마산로 538 해군호텔 W웨딩홀',
        boundingBox: { x: 830, y: 1195, width: 1050, height: 85 },
      },
    ];

    const candidates = extractSpatialFieldCandidates(lines, {
      width: 2400,
      height: 1800,
    });

    expect(candidates.productName?.[0].value).toBe('축하화환 3단');
    expect(candidates.deliveryDate?.[0].value).toBe('2026-06-14');
    expect(candidates.deliveryAddress?.[0].value).toContain('영등포구');
  });

  it('fills missing required fields from spatial candidates without fabricating source text', () => {
    const result = applySpatialOcrFieldHeuristics(
      emptyPipeline(),
      [
        {
          text: '상품명',
          boundingBox: { x: 500, y: 800, width: 180, height: 70 },
        },
        {
          text: '[근조화환 FB268] 근조 3단',
          boundingBox: { x: 820, y: 795, width: 650, height: 80 },
        },
        {
          text: '배송일시',
          boundingBox: { x: 500, y: 930, width: 190, height: 70 },
        },
        {
          text: '2026년 06월 14일 17시 00분 까지 배송',
          boundingBox: { x: 820, y: 925, width: 900, height: 80 },
        },
        {
          text: '배송장소',
          boundingBox: { x: 500, y: 1060, width: 190, height: 70 },
        },
        {
          text: '서울 구로구 고려대 구로병원 장례식장 105호',
          boundingBox: { x: 820, y: 1055, width: 980, height: 85 },
        },
      ],
      { width: 2400, height: 1800 },
    );

    const byKey = Object.fromEntries(result.fields.map((field) => [field.key, field]));
    expect(byKey.productName.value).toContain('근조화환');
    expect(byKey.deliveryDate.value).toBe('2026-06-14');
    expect(byKey.deliveryAddress.value).toContain('구로구');
    expect(byKey.deliveryAddress.sourceText).toContain('배송장소');
    expect(result.documentConfidence).toBeGreaterThan(70);
  });
});
