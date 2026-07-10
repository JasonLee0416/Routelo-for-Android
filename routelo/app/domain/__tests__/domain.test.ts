import {
  compareCalendarItems,
  evaluateCalendarRisks,
  isIsoServiceDate,
  legacyDeliveryToOrder,
  toCalendarDeliveryItem,
} from '..';

const legacy = {
  id: 'legacy-1',
  orderVendor: '발주화원',
  orderVendorTel: '02-111-2222',
  deliveryVendor: '배송화원',
  deliveryVendorTel: '02-333-4444',
  productName: '축하 3단 화환',
  productQuantity: 2,
  eventTime: '13:00',
  deliveryDt: '2026-06-23 12:20',
  deliveryAddress: '서울 영등포구 테스트로 1',
  customerRequests: '사진 전송',
  recipientTel: '010-1111-2222',
  status: 'pending' as const,
  distanceKm: 4.2,
  fee: 15000,
  latitude: 37.5,
  longitude: 126.9,
};

describe('canonical delivery domain', () => {
  it('migrates a legacy delivery without manufactured business values', () => {
    const order = legacyDeliveryToOrder(legacy, '2026-06-23T00:00:00Z');
    expect(order.orderingVendor.name).toBe('발주화원');
    expect(order.schedule.serviceDate).toBe('2026-06-23');
    expect(order.schedule.strictDeadlineAt).toBe(
      '2026-06-23T12:20:00+09:00',
    );
    expect(order.schedule.eventAt).toBe('2026-06-23T13:00:00+09:00');
    expect(order.product.quantity).toBe(2);
  });

  it('keeps malformed legacy schedules reviewable instead of guessing', () => {
    const order = legacyDeliveryToOrder({
      ...legacy,
      deliveryDt: '6월 23일 오후',
      eventTime: '곧',
    });
    expect(order.schedule.serviceDate).toBeUndefined();
    expect(order.schedule.eventAt).toBeUndefined();
    expect(order.schedule.timePrecision).toBe('unknown');
  });

  it('preserves failed and revisit-needed states for UI projections', () => {
    expect(
      legacyDeliveryToOrder({
        ...legacy,
        status: 'failed',
      }).status,
    ).toBe('failed');
    expect(
      legacyDeliveryToOrder({
        ...legacy,
        status: 'revisitNeeded',
      }).status,
    ).toBe('revisitNeeded');
  });

  it('creates calendar projections without parsing display strings', () => {
    const order = legacyDeliveryToOrder(legacy);
    const item = toCalendarDeliveryItem(order);
    expect(item).toMatchObject({
      date: '2026-06-23',
      deadlineAt: '2026-06-23T12:20:00+09:00',
      eventAt: '2026-06-23T13:00:00+09:00',
    });
  });

  it('validates real ISO dates and sorts by operational time', () => {
    expect(isIsoServiceDate('2026-02-29')).toBe(false);
    expect(isIsoServiceDate('2028-02-29')).toBe(true);
    const first = {
      id: 'a',
      deliveryOrderId: 'a',
      date: '2026-06-23',
      deadlineAt: '2026-06-23T10:00:00+09:00',
      title: 'A',
      address: '',
      status: 'pending' as const,
      priority: 'normal' as const,
      timePrecision: 'exact' as const,
    };
    expect(
      compareCalendarItems(first, {
        ...first,
        id: 'b',
        deadlineAt: '2026-06-23T11:00:00+09:00',
      }),
    ).toBeLessThan(0);
  });

  it('marks only explicit overlaps and late planned arrivals', () => {
    const base = {
      id: 'a',
      deliveryOrderId: 'a',
      date: '2026-06-23',
      startAt: '2026-06-23T10:00:00+09:00',
      endAt: '2026-06-23T11:00:00+09:00',
      deadlineAt: '2026-06-23T10:30:00+09:00',
      plannedArrivalAt: '2026-06-23T10:40:00+09:00',
      title: 'A',
      address: '',
      status: 'pending' as const,
      priority: 'normal' as const,
      timePrecision: 'exact' as const,
    };
    const risks = evaluateCalendarRisks([
      base,
      {
        ...base,
        id: 'b',
        deliveryOrderId: 'b',
        startAt: '2026-06-23T10:45:00+09:00',
        endAt: '2026-06-23T11:30:00+09:00',
        plannedArrivalAt: '2026-06-23T10:20:00+09:00',
      },
      {
        ...base,
        id: 'unknown',
        deliveryOrderId: 'unknown',
        startAt: undefined,
        endAt: undefined,
        deadlineAt: undefined,
        plannedArrivalAt: undefined,
      },
    ]);

    expect(risks.get('a')).toEqual({ conflict: true, late: true });
    expect(risks.get('b')).toEqual({ conflict: true, late: false });
    expect(risks.get('unknown')).toEqual({ conflict: false, late: false });
  });
});
