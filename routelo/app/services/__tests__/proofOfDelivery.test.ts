import { DeliveryOrder } from '../../domain';
import {
  appendProofPhoto,
  clearProofOfDelivery,
  completeDeliveryWithProof,
  failDeliveryWithProof,
  hasProofReason,
  markDeliveryForRevisitWithProof,
  normalizeProofReason,
} from '../proofOfDelivery';

const order: DeliveryOrder = {
  schemaVersion: 1,
  id: 'delivery-pod',
  orderingVendor: {},
  fulfillingVendor: {},
  product: {},
  schedule: {
    timezone: 'Asia/Seoul',
    timePrecision: 'unknown',
    priority: 'normal',
  },
  destination: {},
  recipient: {},
  status: 'pending',
  settlement: {},
  source: { type: 'ocr' },
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('proof reason helpers', () => {
  it('normalizes reasons and rejects blank/whitespace input', () => {
    expect(normalizeProofReason('  수령인 부재 ')).toBe('수령인 부재');
    expect(normalizeProofReason('   ')).toBeUndefined();
    expect(normalizeProofReason(undefined)).toBeUndefined();
    expect(hasProofReason('수령인 부재')).toBe(true);
    expect(hasProofReason('   ')).toBe(false);
    expect(hasProofReason(undefined)).toBe(false);
  });
});

describe('appendProofPhoto', () => {
  it('never flips a pending delivery to completed', () => {
    const next = appendProofPhoto(order, 'photos/a.jpg');
    // 전달 전에 찍은 증거 사진이 배송을 완료로 뒤집으면 안 된다.
    expect(next.status).toBe('pending');
    expect(next.schedule.completedAt).toBeUndefined();
    expect(next.proofOfDelivery?.status).toBe('pending');
    expect(next.proofOfDelivery?.photoUris).toEqual(['photos/a.jpg']);
  });

  it('preserves an existing proof outcome and its reason', () => {
    const failed = failDeliveryWithProof(order, { failureReason: '수령인 부재' });
    const next = appendProofPhoto(failed, 'photos/b.jpg');
    expect(next.status).toBe('failed');
    expect(next.proofOfDelivery?.status).toBe('failed');
    expect(next.proofOfDelivery?.failureReason).toBe('수령인 부재');
    expect(next.proofOfDelivery?.photoUris).toEqual(['photos/b.jpg']);
  });

  it('keeps a completed delivery completed without restamping completedAt', () => {
    const done = completeDeliveryWithProof(
      order,
      { completedAt: '2026-07-10T01:00:00.000Z' },
      '2026-07-10T01:00:00.000Z',
    );
    const next = appendProofPhoto(done, 'photos/c.jpg');
    expect(next.status).toBe('completed');
    expect(next.schedule.completedAt).toBe('2026-07-10T01:00:00.000Z');
    expect(next.proofOfDelivery?.photoUris).toEqual(['photos/c.jpg']);
  });
});

describe('proof of delivery helpers', () => {
  it('marks a delivery completed with local proof evidence', () => {
    const completed = completeDeliveryWithProof(
      order,
      {
        completedAt: '2026-07-10T09:00:00.000Z',
        photoUris: ['file:///pod.jpg'],
        note: '문앞 배송 완료',
      },
      '2026-07-10T09:01:00.000Z',
    );

    expect(completed.status).toBe('completed');
    expect(completed.schedule.completedAt).toBe('2026-07-10T09:00:00.000Z');
    expect(completed.proofOfDelivery).toMatchObject({
      status: 'completed',
      completedAt: '2026-07-10T09:00:00.000Z',
      photoUris: ['file:///pod.jpg'],
      note: '문앞 배송 완료',
    });
  });

  it('requires a reason before marking delivery failed', () => {
    expect(() =>
      failDeliveryWithProof(order, { failureReason: '   ' }),
    ).toThrow('failure reason');

    const failed = failDeliveryWithProof(
      order,
      { failureReason: '수령자 부재', note: '전화 연결 안 됨' },
      '2026-07-10T09:02:00.000Z',
    );

    expect(failed.status).toBe('failed');
    expect(failed.proofOfDelivery?.failureReason).toBe('수령자 부재');
  });

  it('supports revisit-needed status with proof evidence', () => {
    const revisit = markDeliveryForRevisitWithProof(
      order,
      { failureReason: '예식장 담당자 요청', photoUris: ['file:///closed.jpg'] },
      '2026-07-10T09:03:00.000Z',
    );

    expect(revisit.status).toBe('revisitNeeded');
    expect(revisit.proofOfDelivery?.photoUris).toEqual(['file:///closed.jpg']);
  });

  it('can clear proof when a completion toggle is reversed', () => {
    const completed = completeDeliveryWithProof(order);
    const cleared = clearProofOfDelivery(completed, '2026-07-10T10:00:00.000Z');

    expect(cleared.status).toBe('pending');
    expect(cleared.schedule.completedAt).toBeUndefined();
    expect(cleared.proofOfDelivery).toBeUndefined();
  });
});
