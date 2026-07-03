import {
  createInitialLiveOcrSession,
  liveOcrChecklistItems,
  liveOcrIncompleteMessage,
  liveOcrReviewQuery,
  liveOcrScannerStepLabel,
  liveOcrStageTitle,
  mergeOcrFields,
  summarizeLiveOcrSession,
  updateLiveOcrSession,
} from '../liveOcr';
import { OcrFieldKey, OcrFieldResult, OcrPipelineResult } from '../../models';

const field = (
  key: OcrFieldKey,
  value: string,
  confidence: number,
): OcrFieldResult => ({
  key,
  label: key,
  value,
  confidence,
  required: false,
  sourceText: value,
  alternatives: [],
  status: confidence >= 85 ? 'confirmed' : 'review',
});

const result = (fields: OcrFieldResult[]): OcrPipelineResult => ({
  engine: 'ppocrv5',
  rawText: fields.map((item) => item.value).join('\n'),
  fields,
  documentConfidence: 80,
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
  processingMs: 100,
  variantsCompared: 1,
  unmapped: [],
});

describe('live OCR session accumulator', () => {
  it('locks the three scan checklist fields only after repeated stable evidence', () => {
    const first = updateLiveOcrSession(
      createInitialLiveOcrSession(),
      result([
        field('orderingVendorName', '꽃마루화원', 90),
        field('deliveryAddress', '서울 강남구 테헤란로 1', 84),
        field('recipientTel', '010-1234-5678', 82),
      ]),
    );

    expect(first.readyForReview).toBe(false);
    expect(first.fields.merchant.status).toBe('candidate');
    expect(first.fields.address.status).toBe('candidate');
    expect(first.fields.phone.status).toBe('candidate');

    const second = updateLiveOcrSession(
      first,
      result([
        field('orderingVendorName', '꽃마루화원', 91),
        field('deliveryAddress', '서울 강남구 테헤란로 1', 86),
        field('recipientTel', '010-1234-5678', 88),
      ]),
    );

    expect(second.readyForReview).toBe(true);
    expect(second.fields.merchant.status).toBe('locked');
    expect(second.fields.address.status).toBe('locked');
    expect(second.fields.phone.status).toBe('locked');
  });

  it('does not lock weak or invalid phone-like values', () => {
    const session = updateLiveOcrSession(
      createInitialLiveOcrSession(),
      result([
        field('orderingVendorName', '꽃마루화원', 90),
        field('deliveryAddress', '서울 강남구 테헤란로 1', 84),
        field('recipientTel', '2026-07-01', 95),
      ]),
    );

    expect(session.fields.phone.status).toBe('missing');
    expect(session.readyForReview).toBe(false);
  });

  it('rejects frames that do not add stable live OCR evidence', () => {
    const session = updateLiveOcrSession(
      createInitialLiveOcrSession(),
      result([
        field('productName', '축하화환', 95),
        field('recipientTel', '2026-07-01', 95),
      ]),
    );

    expect(session.lastFrameAccepted).toBe(false);
    expect(session.acceptedFrameCount).toBe(0);
    expect(session.rejectedFrameCount).toBe(1);
    expect(summarizeLiveOcrSession(session).frameSummary).toBe(
      '1개 프레임 재촬영 필요',
    );
    expect(liveOcrIncompleteMessage(session)).toContain(
      '후보를 안정적으로 찾지 못했습니다',
    );
  });

  it('keeps stronger OCR field candidates when merging frame results', () => {
    const merged = mergeOcrFields(
      [field('deliveryAddress', '서울 강남구', 72)],
      [field('deliveryAddress', '서울 강남구 테헤란로 1', 88)],
    );

    expect(merged[0].value).toBe('서울 강남구 테헤란로 1');
    expect(merged[0].confidence).toBe(88);
  });

  it('builds the vendor verification query from ordering vendor or venue evidence', () => {
    expect(
      liveOcrReviewQuery([
        field('venueName', '라움아트센터', 90),
        field('recipientTel', '02-123-4567', 82),
      ]),
    ).toEqual({
      vendorName: '라움아트센터',
      vendorPhone: '02-123-4567',
    });
  });

  it('builds stable scanner presentation copy from session state', () => {
    const session = updateLiveOcrSession(
      createInitialLiveOcrSession(),
      result([
        field('orderingVendorName', '꽃마루화원', 90),
        field('deliveryAddress', '서울 강남구 테헤란로 1', 84),
      ]),
    );

    expect(summarizeLiveOcrSession(session)).toEqual({
      lockedCount: 0,
      totalCount: 3,
      remainingCount: 3,
      frameSummary: '1개 프레임 누적',
      primaryCaptureLabel: '다음 프레임 촬영',
    });
    expect(liveOcrScannerStepLabel('capture', session)).toBe('0/3');
    expect(liveOcrStageTitle('quality')).toBe('프레임 품질 검사');
    expect(liveOcrIncompleteMessage(session)).toContain('남은 3개 항목');
  });

  it('exposes checklist item status flags and user-facing details', () => {
    const session = updateLiveOcrSession(
      createInitialLiveOcrSession(),
      result([field('recipientTel', '010-1234-5678', 88)]),
    );

    const phone = liveOcrChecklistItems(session).find((item) => item.id === 'phone');

    expect(phone).toMatchObject({
      candidate: true,
      locked: false,
      detail: '010-1234-5678 · 88% · 1프레임',
    });
  });
});
