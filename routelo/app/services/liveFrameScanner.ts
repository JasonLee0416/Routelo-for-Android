import { CaptureQuality, OcrPipelineResult } from '../models';
import {
  createInitialLiveOcrSession,
  LiveOcrSessionState,
  mergeOcrResult,
  updateLiveOcrSession,
} from './liveOcr';
import { inspectCaptureQuality, runReceiptOcr } from './ocr';

export type LiveOcrFrameAsset = {
  uri?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  capturedAt?: number;
};

export type LiveOcrFrameDecision =
  | 'accepted'
  | 'ready'
  | 'skipped-interval'
  | 'skipped-busy'
  | 'rejected-quality'
  | 'ocr-error';

export type LiveOcrScannerTelemetry = {
  sampledFrames: number;
  skippedByInterval: number;
  skippedByBackpressure: number;
  rejectedByQuality: number;
  ocrRuns: number;
  ocrFailures: number;
  acceptedFrames: number;
  promotedFields: number;
  lastOcrMs: number;
};

export type LiveOcrScannerSnapshot = {
  session: LiveOcrSessionState;
  aggregateResult?: OcrPipelineResult;
  telemetry: LiveOcrScannerTelemetry;
  lastQuality?: CaptureQuality;
  inFlight: boolean;
  lastSampledAt?: number;
};

export type LiveOcrFrameScanResult = {
  decision: LiveOcrFrameDecision;
  snapshot: LiveOcrScannerSnapshot;
  result?: OcrPipelineResult;
  error?: Error;
};

export type LiveOcrFrameScannerOptions = {
  minIntervalMs?: number;
  requireQualityPass?: boolean;
  now?: () => number;
  recognizeFrame?: (frame: LiveOcrFrameAsset) => Promise<OcrPipelineResult>;
};

const emptyTelemetry = (): LiveOcrScannerTelemetry => ({
  sampledFrames: 0,
  skippedByInterval: 0,
  skippedByBackpressure: 0,
  rejectedByQuality: 0,
  ocrRuns: 0,
  ocrFailures: 0,
  acceptedFrames: 0,
  promotedFields: 0,
  lastOcrMs: 0,
});

const countLocked = (session: LiveOcrSessionState) =>
  Object.values(session.fields).filter((field) => field.status === 'locked')
    .length;

export class LiveOcrFrameScanner {
  private session = createInitialLiveOcrSession();
  private aggregateResult: OcrPipelineResult | undefined;
  private telemetry = emptyTelemetry();
  private lastQuality: CaptureQuality | undefined;
  private inFlight = false;
  private lastSampledAt: number | undefined;

  constructor(private readonly defaults: LiveOcrFrameScannerOptions = {}) {}

  snapshot(): LiveOcrScannerSnapshot {
    return {
      session: this.session,
      aggregateResult: this.aggregateResult,
      telemetry: { ...this.telemetry },
      lastQuality: this.lastQuality,
      inFlight: this.inFlight,
      lastSampledAt: this.lastSampledAt,
    };
  }

  reset() {
    this.session = createInitialLiveOcrSession();
    this.aggregateResult = undefined;
    this.telemetry = emptyTelemetry();
    this.lastQuality = undefined;
    this.inFlight = false;
    this.lastSampledAt = undefined;
  }

  async acceptFrame(
    frame: LiveOcrFrameAsset,
    options: LiveOcrFrameScannerOptions = {},
  ): Promise<LiveOcrFrameScanResult> {
    const mergedOptions = { ...this.defaults, ...options };
    const now = mergedOptions.now?.() ?? Date.now();
    const minIntervalMs = mergedOptions.minIntervalMs ?? 500;

    if (
      this.lastSampledAt !== undefined &&
      now - this.lastSampledAt < minIntervalMs
    ) {
      this.telemetry.skippedByInterval += 1;
      return { decision: 'skipped-interval', snapshot: this.snapshot() };
    }

    if (this.inFlight) {
      this.telemetry.skippedByBackpressure += 1;
      return { decision: 'skipped-busy', snapshot: this.snapshot() };
    }

    this.lastSampledAt = now;
    this.telemetry.sampledFrames += 1;
    const quality = inspectCaptureQuality(frame);
    this.lastQuality = quality;
    if ((mergedOptions.requireQualityPass ?? true) && !quality.passed) {
      this.telemetry.rejectedByQuality += 1;
      return { decision: 'rejected-quality', snapshot: this.snapshot() };
    }

    this.inFlight = true;
    this.telemetry.ocrRuns += 1;
    try {
      const startedAt = now;
      const recognize = mergedOptions.recognizeFrame ?? runReceiptOcr;
      const result = await recognize(frame);
      this.telemetry.lastOcrMs = Math.max(
        0,
        (mergedOptions.now?.() ?? Date.now()) - startedAt,
      );

      const previousLocked = countLocked(this.session);
      this.aggregateResult = mergeOcrResult(this.aggregateResult, result);
      this.session = updateLiveOcrSession(this.session, result);
      const nextLocked = countLocked(this.session);
      this.telemetry.promotedFields += Math.max(0, nextLocked - previousLocked);
      this.telemetry.acceptedFrames += this.session.lastFrameAccepted ? 1 : 0;

      return {
        decision: this.session.readyForReview ? 'ready' : 'accepted',
        snapshot: this.snapshot(),
        result: this.aggregateResult,
      };
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error('Live OCR frame failed.');
      this.telemetry.ocrFailures += 1;
      return {
        decision: 'ocr-error',
        snapshot: this.snapshot(),
        error: normalized,
      };
    } finally {
      this.inFlight = false;
    }
  }
}
