import { OcrFieldKey, OcrFieldResult, OcrPipelineResult } from '../../models';
import { LiveOcrFrameScanner } from '../liveFrameScanner';

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
  documentConfidence: 90,
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

const goodFrame = {
  uri: 'file:///receipt.jpg',
  width: 1440,
  height: 1920,
};

describe('LiveOcrFrameScanner', () => {
  it('throttles frames by sampling interval before running OCR', async () => {
    let now = 1000;
    const scanner = new LiveOcrFrameScanner({ now: () => now });
    const recognizeFrame = jest.fn(async () =>
      result([field('orderingVendorName', '꽃마루화원', 90)]),
    );

    expect(
      (await scanner.acceptFrame(goodFrame, { recognizeFrame })).decision,
    ).toBe('accepted');
    now = 1200;
    expect(
      (await scanner.acceptFrame(goodFrame, { recognizeFrame })).decision,
    ).toBe('skipped-interval');
    expect(recognizeFrame).toHaveBeenCalledTimes(1);
    expect(scanner.snapshot().telemetry.skippedByInterval).toBe(1);
  });

  it('rejects poor quality frames before OCR', async () => {
    const scanner = new LiveOcrFrameScanner({ minIntervalMs: 0 });
    const recognizeFrame = jest.fn(async () => result([]));

    const scan = await scanner.acceptFrame(
      { uri: 'file:///tiny.jpg', width: 200, height: 200 },
      { recognizeFrame },
    );

    expect(scan.decision).toBe('rejected-quality');
    expect(recognizeFrame).not.toHaveBeenCalled();
    expect(scan.snapshot.telemetry.rejectedByQuality).toBe(1);
  });

  it('accumulates repeated evidence and transitions to ready without auto-saving', async () => {
    let index = 0;
    const frames = [
      result([
        field('orderingVendorName', '꽃마루화원', 90),
        field('deliveryAddress', '서울 강남구 테헤란로 1', 84),
        field('recipientTel', '010-1234-5678', 82),
      ]),
      result([
        field('orderingVendorName', '꽃마루화원', 91),
        field('deliveryAddress', '서울 강남구 테헤란로 1', 86),
        field('recipientTel', '010-1234-5678', 88),
      ]),
    ];
    const scanner = new LiveOcrFrameScanner({ minIntervalMs: 0 });
    const recognizeFrame = jest.fn(async () => frames[index++]);

    expect(
      (await scanner.acceptFrame(goodFrame, { recognizeFrame })).decision,
    ).toBe('accepted');
    const second = await scanner.acceptFrame(goodFrame, { recognizeFrame });

    expect(second.decision).toBe('ready');
    expect(second.snapshot.session.readyForReview).toBe(true);
    expect(second.snapshot.telemetry.promotedFields).toBe(3);
    expect(second.snapshot.aggregateResult?.fields).toHaveLength(3);
  });

  it('drops frames while OCR inference is in flight instead of queueing', async () => {
    let release!: () => void;
    const pending = new Promise<OcrPipelineResult>((resolve) => {
      release = () => resolve(result([field('orderingVendorName', '꽃마루화원', 90)]));
    });
    const scanner = new LiveOcrFrameScanner({ minIntervalMs: 0 });
    const first = scanner.acceptFrame(goodFrame, {
      recognizeFrame: () => pending,
    });

    const second = await scanner.acceptFrame(goodFrame, {
      recognizeFrame: async () => result([]),
    });
    release();
    await first;

    expect(second.decision).toBe('skipped-busy');
    expect(scanner.snapshot().telemetry.skippedByBackpressure).toBe(1);
  });

  it('accepts native-recognized frame results without re-running image OCR', async () => {
    const scanner = new LiveOcrFrameScanner({ minIntervalMs: 0 });
    const scan = await scanner.acceptRecognizedNativeFrame(
      result([
        field('orderingVendorName', 'Native OCR Flower', 90),
        field('deliveryAddress', 'Seoul Gangnam Test Road 1', 88),
      ]),
      {
        source: 'native-frame',
        width: 1280,
        height: 720,
        capturedAt: 3000,
        timestamp: 123,
        orientation: 'right',
        pixelFormat: 'yuv-420-8-bit-video',
        platform: 'android',
        recognizerId: 'android-native-ppocr',
      },
    );

    expect(scan.decision).toBe('accepted');
    expect(scan.snapshot.telemetry).toMatchObject({
      sampledFrames: 1,
      ocrRuns: 1,
      acceptedFrames: 1,
      lastOcrMs: 100,
    });
    expect(scan.snapshot.aggregateResult?.rawText).toContain(
      'Native OCR Flower',
    );
  });

  it('rejects low-quality native-recognized frame results before accumulation', async () => {
    const scanner = new LiveOcrFrameScanner({ minIntervalMs: 0 });
    const lowQuality = result([field('orderingVendorName', 'Noise', 90)]);
    lowQuality.quality = {
      ...lowQuality.quality,
      passed: false,
      score: 40,
      messages: ['Native OCR frame quality is too low.'],
    };

    const scan = await scanner.acceptRecognizedNativeFrame(lowQuality, {
      source: 'native-frame',
      width: 320,
      height: 180,
      capturedAt: 4000,
      platform: 'ios',
      recognizerId: 'apple-vision',
    });

    expect(scan.decision).toBe('rejected-quality');
    expect(scan.snapshot.aggregateResult).toBeUndefined();
    expect(scan.snapshot.telemetry).toMatchObject({
      sampledFrames: 1,
      rejectedByQuality: 1,
      ocrRuns: 0,
    });
  });
});
