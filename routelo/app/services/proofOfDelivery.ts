import { DeliveryOrder, ProofOfDelivery } from '../domain';

export type CompleteDeliveryProofInput = {
  completedAt?: string;
  photoUris?: string[];
  note?: string;
  signatureUri?: string;
};

export type FailedDeliveryProofInput = {
  recordedAt?: string;
  photoUris?: string[];
  note?: string;
  failureReason: string;
};

export type RevisitDeliveryProofInput = {
  recordedAt?: string;
  photoUris?: string[];
  note?: string;
  failureReason: string;
};

const cleanText = (value?: string) => value?.trim() || undefined;

// 실패/재방문 사유는 운전자가 직접 입력한 값만 신뢰한다. UI 제출 게이팅과
// 서비스 검증이 같은 규칙을 쓰도록 순수 헬퍼로 노출한다(하드코딩 기본 사유 금지).
export function normalizeProofReason(value?: string): string | undefined {
  return cleanText(value);
}

export function hasProofReason(value?: string): boolean {
  return Boolean(normalizeProofReason(value));
}

function proofBase(
  status: ProofOfDelivery['status'],
  recordedAt: string,
  photoUris: string[] = [],
): ProofOfDelivery {
  return {
    status,
    recordedAt,
    photoUris: photoUris.filter(Boolean),
  };
}

export function completeDeliveryWithProof(
  order: DeliveryOrder,
  input: CompleteDeliveryProofInput = {},
  now = new Date().toISOString(),
): DeliveryOrder {
  const completedAt = input.completedAt || now;
  return {
    ...order,
    status: 'completed',
    schedule: {
      ...order.schedule,
      completedAt,
    },
    proofOfDelivery: {
      ...proofBase('completed', now, input.photoUris),
      completedAt,
      note: cleanText(input.note),
      signatureUri: cleanText(input.signatureUri),
    },
    updatedAt: now,
  };
}

export function failDeliveryWithProof(
  order: DeliveryOrder,
  input: FailedDeliveryProofInput,
  now = new Date().toISOString(),
): DeliveryOrder {
  const reason = cleanText(input.failureReason);
  if (!reason) throw new Error('Failed delivery proof requires a failure reason.');
  const recordedAt = input.recordedAt || now;
  return {
    ...order,
    status: 'failed',
    proofOfDelivery: {
      ...proofBase('failed', recordedAt, input.photoUris),
      note: cleanText(input.note),
      failureReason: reason,
    },
    updatedAt: now,
  };
}

export function markDeliveryForRevisitWithProof(
  order: DeliveryOrder,
  input: RevisitDeliveryProofInput,
  now = new Date().toISOString(),
): DeliveryOrder {
  const reason = cleanText(input.failureReason);
  if (!reason) throw new Error('Revisit proof requires a reason.');
  const recordedAt = input.recordedAt || now;
  return {
    ...order,
    status: 'revisitNeeded',
    proofOfDelivery: {
      ...proofBase('revisitNeeded', recordedAt, input.photoUris),
      note: cleanText(input.note),
      failureReason: reason,
    },
    updatedAt: now,
  };
}

export function clearProofOfDelivery(
  order: DeliveryOrder,
  now = new Date().toISOString(),
): DeliveryOrder {
  return {
    ...order,
    status: 'pending',
    schedule: {
      ...order.schedule,
      completedAt: undefined,
    },
    proofOfDelivery: undefined,
    updatedAt: now,
  };
}

export function appendProofPhoto(
  order: DeliveryOrder,
  photoUri: string,
  now = new Date().toISOString(),
): DeliveryOrder {
  // 사진 첨부는 '증거 수집'일 뿐 배송 결과가 아니다. 전달 전에 찍은 사진이
  // 배송을 완료로 뒤집던 문제가 있어, 여기서는 order.status/completedAt을
  // 절대 건드리지 않는다. 완료/실패/재방문은 전용 함수로만 기록한다.
  const proof: ProofOfDelivery = order.proofOfDelivery ?? {
    status: 'pending',
    recordedAt: now,
    photoUris: [],
  };
  return {
    ...order,
    proofOfDelivery: {
      ...proof,
      photoUris: [...(proof.photoUris ?? []), photoUri],
    },
    updatedAt: now,
  };
}
