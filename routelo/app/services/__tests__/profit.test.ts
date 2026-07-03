import { DeliveryOrder } from '../../domain';
import { FuelLog } from '../../models';
import { DEFAULT_ROUTELO_SETTINGS, RouteloSettings } from '../../settings';
import { calculateFeeByAddress, findDistrictByAddress } from '../maps';
import {
  createCalendarProfitDays,
  summarizeDailyProfit,
  summarizePeriodProfit,
} from '../profit';

const settings: RouteloSettings = {
  ...DEFAULT_ROUTELO_SETTINGS,
  fees: {
    ...DEFAULT_ROUTELO_SETTINGS.fees,
    districtFees: {
      ...DEFAULT_ROUTELO_SETTINGS.fees.districtFees,
      Seoul: {
        ...DEFAULT_ROUTELO_SETTINGS.fees.districtFees.Seoul,
        강남구: 18000,
      },
      Gyeonggi: {
        ...DEFAULT_ROUTELO_SETTINGS.fees.districtFees.Gyeonggi,
        수원시: 24000,
      },
    },
  },
};

const order = (
  id: string,
  date: string | undefined,
  address: string,
  fee?: number,
): DeliveryOrder => ({
  schemaVersion: 1,
  id,
  status: 'pending',
  schedule: {
    serviceDate: date,
    timezone: 'Asia/Seoul',
    timePrecision: date ? 'date-only' : 'unknown',
    priority: 'normal',
  },
  destination: { address },
  recipient: {},
  orderingVendor: {},
  fulfillingVendor: {},
  product: {},
  settlement: { fee },
  source: { type: 'manual' },
  createdAt: '2026-06-24T00:00:00+09:00',
  updatedAt: '2026-06-24T00:00:00+09:00',
});

describe('district fee lookup', () => {
  test('matches Seoul and Gyeonggi addresses after whitespace normalization', () => {
    expect(findDistrictByAddress('서울특별시 강남구 테헤란로', settings)).toBe('강남구');
    expect(findDistrictByAddress('경기도 수원시 팔달구', settings)).toBe('수원시');
  });

  test('uses the configured fee and falls back safely for unknown districts', () => {
    expect(calculateFeeByAddress('서울 강남구 삼성동', settings)).toBe(18000);
    expect(calculateFeeByAddress('세종특별자치시 세종시', settings)).toBe(15000);
  });
});

describe('profit summaries', () => {
  const fuelLogs: FuelLog[] = [
    {
      id: 'fuel-1',
      date: '2026-06-24',
      pricePerLiter: 1700,
      liters: 10,
      amount: 17000,
      odometerKm: 1000,
    },
  ];

  test('prefers saved fees, applies district defaults, and deducts fuel by date', () => {
    const summaries = summarizeDailyProfit(
      [
        order('saved', '2026-06-24', '서울 강남구', 30000),
        order('configured', '2026-06-24', '경기도 수원시'),
        order('unscheduled', undefined, '서울 강남구'),
      ],
      fuelLogs,
      settings,
    );

    expect(summaries.get('2026-06-24')).toEqual({
      revenue: 54000,
      fuelCost: 17000,
      net: 37000,
      count: 2,
    });
    expect(summaries.size).toBe(1);
  });

  test('keeps fuel-only dates as negative net results', () => {
    const summaries = summarizeDailyProfit(
      [],
      [
        {
          id: 'fuel-only',
          date: '2026-06-25',
          pricePerLiter: 1800,
          liters: 5,
          amount: 9000,
          odometerKm: 1050,
        },
      ],
      settings,
    );

    expect(summaries.get('2026-06-25')).toEqual({
      revenue: 0,
      fuelCost: 9000,
      net: -9000,
      count: 0,
    });
  });

  test('builds calendar profit days and period totals for the calendar view', () => {
    const orders = [
      order('a', '2026-06-24', '서울 강남구', 30000),
      order('b', '2026-06-25', '경기도 수원시'),
    ];
    const days = createCalendarProfitDays(orders, fuelLogs, settings);
    const totals = summarizePeriodProfit(days);

    expect(days).toEqual([
      {
        date: '2026-06-24',
        revenue: 30000,
        fuelCost: 17000,
        net: 13000,
        deliveryCount: 1,
        hasFuelCost: true,
        hasRevenue: true,
      },
      {
        date: '2026-06-25',
        revenue: 24000,
        fuelCost: 0,
        net: 24000,
        deliveryCount: 1,
        hasFuelCost: false,
        hasRevenue: true,
      },
    ]);
    expect(totals).toEqual({
      revenue: 54000,
      fuelCost: 17000,
      net: 37000,
      deliveryCount: 2,
    });
  });
});
