import { OcrPipelineResult } from '../../models';
import { enrichOcrPipelineResult } from '../ocrMetadata';

const baseResult = (): OcrPipelineResult => ({
  engine: 'fixture',
  rawText: '축하화환\n010-1234-5678',
  fields: [
    {
      key: 'productName',
      label: '상품명',
      value: '축하화환',
      confidence: 90,
      required: true,
      sourceText: '축하화환',
      alternatives: [],
      status: 'confirmed',
    },
    {
      key: 'deliveryDate',
      label: '배송일',
      value: '',
      confidence: 0,
      required: true,
      sourceText: '',
      alternatives: [],
      status: 'missing',
    },
    {
      key: 'deliveryAddress',
      label: '배송주소',
      value: '서울 강남구',
      confidence: 70,
      required: true,
      sourceText: '서울 강남구',
      alternatives: [],
      status: 'review',
    },
    {
      key: 'recipientTel',
      label: '수령인 전화',
      value: '010-1234-5678',
      confidence: 90,
      required: false,
      sourceText: '010-1234-5678',
      alternatives: [],
      status: 'confirmed',
    },
  ],
  documentConfidence: 53,
  quality: {
    score: 90,
    blur: 90,
    brightness: 90,
    documentCoverage: 90,
    skew: 90,
    shadow: 90,
    passed: true,
    messages: [],
  },
  processingMs: 1,
  variantsCompared: 1,
  unmapped: [],
});

describe('OCR metadata enrichment', () => {
  it('marks fallback reasons, event type, and phone kind', () => {
    const result = enrichOcrPipelineResult(baseResult());
    expect(result.cloudFallback?.trigger).toBe(true);
    expect(result.cloudFallback?.reasons.join(' ')).toContain('필수 항목 누락');
    expect(result.eventType).toMatchObject({ type: 'congratulation' });
    expect(result.fields.find((field) => field.key === 'recipientTel')?.phoneKind).toBe('direct');
  });
});
