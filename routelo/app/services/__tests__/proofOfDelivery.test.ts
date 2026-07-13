import { DeliveryOrder } from '../../domain';
import {
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
