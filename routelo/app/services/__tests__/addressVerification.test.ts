import { DEFAULT_ROUTELO_SETTINGS } from '../../settings';
import {
  applyVerifiedAddressToOrder,
  createOfflineAddressCandidates,
  hasTrustedDestination,
  selectAddressCandidate,
  selectedAddressCandidate,
} from '../addressVerification';
import { DeliveryOrder } from '../../domain';

const baseOrder: DeliveryOrder = {
  schemaVersion: 1,
  id: 'delivery-test',
  orderingVendor: {},
  fulfillingVendor: {},
  product: {},
  schedule: {
    timezone: 'Asia/Seoul',
    timePrecision: 'unknown',
    priority: 'normal',
  },
  destination: {
    address: '서울 강남구 테헤란로 123 예식장 3층',
  },
  recipient: {},
  status: 'pending',
  settlement: {},
  source: { type: 'ocr' },
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('address verification candidates', () => {
  it('creates deterministic candidates for a valid Korean address', () => {
    const result = createOfflineAddressCandidates(
      '서울 강남구 테헤란로 123 예식장 3층',
      DEFAULT_ROUTELO_SETTINGS,
    );

    expect(result.status).toBe('candidate');
    expect(result.candidates[0]).toMatchObject({
      provider: 'offline-deterministic',
      displayAddress: '서울 강남구 테헤란로 123 예식장 3층',
      district: '강남구',
      source: 'ocr',
    });
    expect(result.candidates[0].latitude).toBeGreaterThan(37);
    expect(result.candidates[0].longitude).toBeGreaterThan(126);
  });

  it('rejects label/phone noise instead of creating trusted candidates', () => {
    const result = createOfflineAddressCandidates(
      '받는분: 고인김기회 TEL',
      DEFAULT_ROUTELO_SETTINGS,
    );

    expect(result.status).toBe('needsReview');
    expect(result.candidates).toEqual([]);
    expect(result.warnings[0]).toContain('직접 확인');
  });

  it('selects a candidate and applies coordinates to an order', () => {
    const result = createOfflineAddressCandidates(
      '서울 강남구 테헤란로 123 예식장 3층',
      DEFAULT_ROUTELO_SETTINGS,
    );
    const selected = selectAddressCandidate(result, result.candidates[0].id);
    const candidate = selectedAddressCandidate(selected);
    const order = applyVerifiedAddressToOrder(baseOrder, selected);

    expect(candidate?.id).toBe(result.candidates[0].id);
    expect(order.destination.latitude).toBe(candidate?.latitude);
    expect(order.destination.longitude).toBe(candidate?.longitude);
    expect(order.settlement.district).toBe('강남구');
    expect(hasTrustedDestination(order)).toBe(true);
  });

  it('does not treat unverified destinations as trusted', () => {
    expect(hasTrustedDestination(baseOrder)).toBe(false);
  });
});
