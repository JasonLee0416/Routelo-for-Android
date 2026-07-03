import { OcrFieldKey, OcrFieldResult, OcrPipelineResult } from '../models';

export type LiveOcrFieldId = 'merchant' | 'address' | 'phone';

export type LiveOcrFieldState = {
  id: LiveOcrFieldId;
  label: string;
  status: 'missing' | 'candidate' | 'locked';
  value: string;
  confidence: number;
  supportCount: number;
  sourceKeys: OcrFieldKey[];
};

export type LiveOcrSessionState = {
  fields: Record<LiveOcrFieldId, LiveOcrFieldState>;
  frameCount: number;
  acceptedFrameCount: number;
  rejectedFrameCount: number;
  lastFrameAccepted: boolean;
  readyForReview: boolean;
};

export type LiveOcrScanStage = 'capture' | 'quality' | 'processing' | 'review';

export type LiveOcrChecklistItem = LiveOcrFieldState & {
  locked: boolean;
  candidate: boolean;
  detail: string;
};

export type LiveOcrSessionSummary = {
  lockedCount: number;
  totalCount: number;
  remainingCount: number;
  frameSummary: string;
  primaryCaptureLabel: string;
};

const LIVE_FIELD_DEFINITIONS: Array<{
  id: LiveOcrFieldId;
  label: string;
  keys: OcrFieldKey[];
  threshold: number;
  validate?: (value: string) => boolean;
}> = [
  {
    id: 'merchant',
    label: '상호명 / 발주처',
    keys: ['orderingVendorName', 'venueName'],
    threshold: 85,
  },
  {
    id: 'address',
    label: '주소 / 배송지',
    keys: ['deliveryAddress'],
    threshold: 80,
  },
  {
    id: 'phone',
    label: '전화번호 후보',
    keys: ['orderingVendorTel', 'fulfillingVendorTel', 'recipientTel'],
    threshold: 80,
    validate: (value) =>
      /^(?:01[016789]-\d{3,4}-\d{4}|02-\d{3,4}-\d{4}|0[3-6]\d-\d{3,4}-\d{4})$/.test(
        value,
      ),
  },
];

const REQUIRED_SUPPORT_COUNT = 2;

export const createInitialLiveOcrSession = (): LiveOcrSessionState => {
  const fields = LIVE_FIELD_DEFINITIONS.reduce(
    (acc, definition) => ({
      ...acc,
      [definition.id]: {
        id: definition.id,
        label: definition.label,
        status: 'missing',
        value: '',
        confidence: 0,
        supportCount: 0,
        sourceKeys: definition.keys,
      },
    }),
    {} as Record<LiveOcrFieldId, LiveOcrFieldState>,
  );

  return {
    fields,
    frameCount: 0,
    acceptedFrameCount: 0,
    rejectedFrameCount: 0,
    lastFrameAccepted: false,
    readyForReview: false,
  };
};

export function mergeOcrFields(
  current: OcrFieldResult[],
  incoming: OcrFieldResult[],
): OcrFieldResult[] {
  if (!current.length) return incoming;
  const byKey = new Map<OcrFieldKey, OcrFieldResult>();
  for (const field of current) byKey.set(field.key, field);

  for (const field of incoming) {
    const existing = byKey.get(field.key);
    if (!existing) {
      byKey.set(field.key, field);
      continue;
    }
    if (
      (!existing.value.trim() && field.value.trim()) ||
      field.confidence > existing.confidence
    ) {
      byKey.set(field.key, field);
    }
  }

  return current.map((field) => byKey.get(field.key) ?? field);
}

export function mergeOcrResult(
  current: OcrPipelineResult | undefined,
  incoming: OcrPipelineResult,
): OcrPipelineResult {
  if (!current) return incoming;
  const mergedFields = mergeOcrFields(current.fields, incoming.fields);
  return {
    ...incoming,
    rawText: [current.rawText, incoming.rawText].filter(Boolean).join('\n\n'),
    fields: mergedFields,
    documentConfidence: Math.max(
      current.documentConfidence,
      incoming.documentConfidence,
    ),
    processingMs: current.processingMs + incoming.processingMs,
    variantsCompared: current.variantsCompared + incoming.variantsCompared,
    unmapped: [...current.unmapped, ...incoming.unmapped],
    recognizedLines: [
      ...(current.recognizedLines ?? []),
      ...(incoming.recognizedLines ?? []),
    ],
  };
}

export function updateLiveOcrSession(
  session: LiveOcrSessionState,
  result: OcrPipelineResult,
): LiveOcrSessionState {
  const nextFields = { ...session.fields };
  let frameAccepted = false;

  for (const definition of LIVE_FIELD_DEFINITIONS) {
    const current = nextFields[definition.id];
    if (current.status === 'locked') continue;

    const candidate = strongestCandidate(result.fields, definition.keys);
    if (!candidate || !candidate.value.trim()) continue;
    if (candidate.confidence < definition.threshold) continue;
    if (definition.validate && !definition.validate(candidate.value)) continue;

    const sameValue =
      normalizeCandidate(candidate.value) === normalizeCandidate(current.value);
    const supportCount = sameValue ? current.supportCount + 1 : 1;
    const confidence = Math.max(current.confidence, candidate.confidence);
    const status = supportCount >= REQUIRED_SUPPORT_COUNT ? 'locked' : 'candidate';

    nextFields[definition.id] = {
      ...current,
      status,
      value: candidate.value,
      confidence,
      supportCount,
    };
    frameAccepted = true;
  }

  const readyForReview = Object.values(nextFields).every(
    (field) => field.status === 'locked',
  );

  return {
    fields: nextFields,
    frameCount: session.frameCount + 1,
    acceptedFrameCount: session.acceptedFrameCount + (frameAccepted ? 1 : 0),
    rejectedFrameCount: session.rejectedFrameCount + (frameAccepted ? 0 : 1),
    lastFrameAccepted: frameAccepted,
    readyForReview,
  };
}

export function liveOcrReviewQuery(fields: OcrFieldResult[]): {
  vendorName: string;
  vendorPhone?: string;
} {
  const vendorName =
    valueOf(fields, 'orderingVendorName') || valueOf(fields, 'venueName');
  const vendorPhone =
    valueOf(fields, 'orderingVendorTel') ||
    valueOf(fields, 'fulfillingVendorTel') ||
    valueOf(fields, 'recipientTel');
  return { vendorName, vendorPhone: vendorPhone || undefined };
}

export function summarizeLiveOcrSession(
  session: LiveOcrSessionState,
): LiveOcrSessionSummary {
  const fields = Object.values(session.fields);
  const lockedCount = fields.filter((field) => field.status === 'locked').length;
  const totalCount = fields.length;
  const remainingCount = Math.max(totalCount - lockedCount, 0);

  return {
    lockedCount,
    totalCount,
    remainingCount,
    frameSummary: session.acceptedFrameCount
      ? `${session.acceptedFrameCount}개 프레임 누적`
      : session.rejectedFrameCount
        ? `${session.rejectedFrameCount}개 프레임 재촬영 필요`
        : '프레임 대기 중',
    primaryCaptureLabel: session.acceptedFrameCount
      ? '다음 프레임 촬영'
      : '첫 프레임 촬영',
  };
}

export function liveOcrChecklistItems(
  session: LiveOcrSessionState,
): LiveOcrChecklistItem[] {
  return Object.values(session.fields).map((field) => {
    const locked = field.status === 'locked';
    const candidate = field.status === 'candidate';
    return {
      ...field,
      locked,
      candidate,
      detail: field.value
        ? `${field.value} · ${field.confidence}% · ${field.supportCount}프레임`
        : '아직 안정적으로 인식되지 않음',
    };
  });
}

export function liveOcrStageTitle(stage: LiveOcrScanStage): string {
  if (stage === 'capture') return '라이브 인수증 인식';
  if (stage === 'quality') return '프레임 품질 검사';
  if (stage === 'processing') return '문서 분석 중';
  return '추출 결과 확인';
}

export function liveOcrScannerStepLabel(
  stage: LiveOcrScanStage,
  session: LiveOcrSessionState,
): string {
  if (stage === 'capture') {
    const summary = summarizeLiveOcrSession(session);
    return `${summary.lockedCount}/${summary.totalCount}`;
  }
  if (stage === 'quality') return '품질';
  if (stage === 'processing') return 'OCR';
  return '검토';
}

export function liveOcrIncompleteMessage(session: LiveOcrSessionState): string {
  const summary = summarizeLiveOcrSession(session);
  if (!session.lastFrameAccepted) {
    return '이번 프레임에서는 상호명·주소·전화번호 후보를 안정적으로 찾지 못했습니다. 인수증 전체가 밝고 흔들리지 않게 보이도록 다시 촬영해 주세요.';
  }
  return summary.remainingCount
    ? `인식된 항목은 고정했습니다. 남은 ${summary.remainingCount}개 항목을 채우려면 인수증을 더 가까이 맞추고 다음 프레임을 촬영해 주세요.`
    : '필수 인식 항목이 모두 고정되었습니다. 추출 결과를 검토해 주세요.';
}

const valueOf = (fields: OcrFieldResult[], key: OcrFieldKey) =>
  fields.find((field) => field.key === key)?.value.trim() ?? '';

const strongestCandidate = (
  fields: OcrFieldResult[],
  keys: OcrFieldKey[],
) =>
  fields
    .filter((field) => keys.includes(field.key))
    .filter((field) => field.value.trim())
    .sort((left, right) => right.confidence - left.confidence)[0];

const normalizeCandidate = (value: string) =>
  value.replace(/\s+/g, '').replace(/[()-]/g, '').toLowerCase();
