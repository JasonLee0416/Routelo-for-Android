import {
  ocrDiagnosticComparisonEnabled,
  runOcrDiagnosticComparison,
  selectBestOcrDiagnosticCandidate,
} from '../ocrDiagnostics';

const quality = {
  score: 92,
  blur: 90,
  brightness: 90,
  documentCoverage: 90,
  skew: 90,
  shadow: 90,
  passed: true,
  measured: true,
  messages: [],
};

const usefulReceiptText = [
  '배송 인수증',
  '상품명: 축하화환',
  '배달주소: 서울 영등포구 가마산로 538',
  '배달일시: 2026.06.14',
  '전화: 010-1234-5678',
].join('\n');

describe('OCR diagnostic comparison', () => {
  it('is enabled for the OCR recovery test profile', () => {
    expect(
      ocrDiagnosticComparisonEnabled({
        EXPO_PUBLIC_ROUTELO_OCR_PROFILE: 'ocr-recovery-test',
      }),
    ).toBe(true);
  });

  it('keeps per-engine evidence and selects the best successful candidate', async () => {
    const report = await runOcrDiagnosticComparison(
      {
        uri: 'file:///prepared-receipt.jpg',
        originalUri: 'file:///original-receipt.jpg',
        width: 1600,
        height: 2200,
        normalized: true,
      },
      quality,
      {
        platform: 'android',
        candidates: [
          {
            id: 'ppocrv5',
            label: 'PP-OCRv5 local',
            modelVersion: 'test-ppocr',
            available: true,
            async recognizeImage() {
              return {
                engine: 'ppocrv5',
                modelVersion: 'test-ppocr',
                fullText: '',
                lines: [],
                processingMs: 10,
                diagnostics: {
                  preprocessProfileId: 'ocr-recovery-test',
                  regionCount: 0,
                  acceptedLineCount: 0,
                  rawTextLength: 0,
                  orientationCandidates: [],
                },
              };
            },
          },
          {
            id: 'mlkit-v2-korean',
            label: 'Android Korean Text OCR',
            modelVersion: 'test-android-text',
            available: true,
            async recognizeImage() {
              return {
                engine: 'mlkit-v2-korean',
                modelVersion: 'test-android-text',
                fullText: usefulReceiptText,
                lines: usefulReceiptText
                  .split('\n')
                  .map((text) => ({ text, confidence: 0.86 })),
                processingMs: 42,
                diagnostics: {
                  preprocessProfileId: 'android-korean-text',
                  regionCount: 4,
                  acceptedLineCount: 5,
                  rawTextLength: usefulReceiptText.length,
                  orientationCandidates: [],
                },
              };
            },
          },
        ],
      },
    );

    expect(report.candidates).toHaveLength(2);
    expect(report.candidates[0]).toMatchObject({
      id: 'ppocrv5',
      status: 'no-text',
      rawTextLength: 0,
    });
    expect(report.candidates[1]).toMatchObject({
      id: 'mlkit-v2-korean',
      status: 'success',
      rawTextLength: usefulReceiptText.length,
      populatedFieldCount: expect.any(Number),
    });
    expect(report.candidates[1].populatedFieldCount).toBeGreaterThan(0);
    expect(report.bestCandidateId).toBe('mlkit-v2-korean');
    expect(report.decision).toBe('use-best-candidate');
    expect(selectBestOcrDiagnosticCandidate(report.candidates)?.id).toBe(
      'mlkit-v2-korean',
    );
  });

  it('preserves raw failed-candidate diagnostics instead of fabricating a result', async () => {
    const report = await runOcrDiagnosticComparison(
      { uri: 'file:///prepared-receipt.jpg', width: 1200, height: 1600 },
      quality,
      {
        platform: 'android',
        candidates: [
          {
            id: 'ppocrv5',
            label: 'PP-OCRv5 local',
            modelVersion: 'test-ppocr',
            available: true,
            async recognizeImage() {
              return {
                engine: 'ppocrv5',
                modelVersion: 'test-ppocr',
                fullText: 'garbled TEL',
                lines: [{ text: 'garbled TEL', confidence: 0.9 }],
                processingMs: 15,
                diagnostics: {
                  preprocessProfileId: 'ocr-recovery-test',
                  regionCount: 1,
                  acceptedLineCount: 1,
                  rawTextLength: 11,
                  orientationCandidates: [],
                },
              };
            },
          },
        ],
      },
    );

    expect(report.decision).toBe('manual-review-required');
    expect(report.bestCandidateId).toBeUndefined();
    expect(report.candidates[0]).toMatchObject({
      status: 'no-text',
      rawTextLength: 11,
      lineCount: 1,
      populatedFieldCount: 0,
    });
    expect(report.candidates[0].result).toBeUndefined();
  });
});
