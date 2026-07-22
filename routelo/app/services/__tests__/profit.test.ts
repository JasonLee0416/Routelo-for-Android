import { DeliveryOrder } from '../../domain';
import { FuelLog } from '../../models';
import { DEFAULT_ROUTELO_SETTINGS, RouteloSettings } from '../../settings';
import { calculateFeeByAddress, findDistrictByAddress } from '../maps';
import {
  buildProfitTrend,
  createCalendarProfitDays,
  summarizeDailyProfit,
  summarizePeriodProfit,
  type DailyProfitSummary,
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

describe('buildProfitTrend', () => {
  const summary = (
    net: number,
    count = 1,
    fuelCost = 0,
  ): DailyProfitSummary => ({ revenue: net + fuelCost, fuelCost, net, count });

  it('sorts by date, keeps only active days, and takes the most recent N', () => {
    const daily = new Map<string, DailyProfitSummary>([
      ['2026-07-03', summary(3000)],
      ['2026-07-01', summary(1000)],
      ['2026-07-02', summary(2000)],
      // 배송도 유류비도 없는 날은 막대가 뭉개지므로 제외한다.
      ['2026-07-04', summary(0, 0, 0)],
    ]);
    const trend = buildProfitTrend(daily, 2);
    expect(trend.map((point) => point.date)).toEqual([
      '2026-07-02',
      '2026-07-03',
    ]);
    expect(trend[0].label).toBe('07/02');
    expect(trend[1].net).toBe(3000);
  });

  it('keeps fuel-only days and handles an empty map', () => {
    const daily = new Map<string, DailyProfitSummary>([
      ['2026-07-05', summary(-8000, 0, 8000)],
    ]);
    expect(buildProfitTrend(daily)).toHaveLength(1);
    expect(buildProfitTrend(new Map())).toEqual([]);
  });
});

describe('buildProfitTrend future dates', () => {
  const summary = (net: number): DailyProfitSummary => ({
    revenue: net,
    fuelCost: 0,
    net,
    count: 1,
  });

  it('excludes scheduled future deliveries from the recent-actuals trend', () => {
    const today = new Date(2026, 6, 22); // 2026-07-22 (local)
    const daily = new Map<string, DailyProfitSummary>([
      ['2026-07-20', summary(1000)],
      ['2026-07-22', summary(2000)],
      // 다음 달로 예약된 배송은 아직 실적이 아니다.
      ['2026-08-15', summary(9999)],
    ]);
    const trend = buildProfitTrend(daily, 8, today);
    expect(trend.map((point) => point.date)).toEqual([
      '2026-07-20',
      '2026-07-22',
    ]);
  });

  it('keeps today itself in the window', () => {
    const today = new Date(2026, 6, 22);
    const daily = new Map<string, DailyProfitSummary>([
      ['2026-07-22', summary(500)],
    ]);
    expect(buildProfitTrend(daily, 8, today)).toHaveLength(1);
  });
});
