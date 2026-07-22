import { DeliveryOrder } from '../../domain';
import { DEFAULT_ROUTELO_SETTINGS } from '../../settings';
import { buildBackupJson, parseBackup } from '../backup';
import { summarizeEfficiencyByVehicle } from '../efficiency';
import { buildDailyProfitCsv } from '../export';
import { createFuelLog } from '../fuel';
import { createMileageLog } from '../mileage';
import { buildPlannedNotifications } from '../notificationPlan';
import { summarizeDailyProfit } from '../profit';

const order = (id: string): DeliveryOrder => ({
  schemaVersion: 1,
  id,
  orderingVendor: {},
  fulfillingVendor: {},
  product: { name: '축하화환' },
  schedule: {
    serviceDate: '2026-07-16',
    timezone: 'Asia/Seoul',
    strictDeadlineAt: '2026-07-16T12:00:00.000+09:00',
    eventAt: '2026-07-16T13:00:00.000+09:00',
    timePrecision: 'exact',
    priority: 'urgent',
  },
  destination: { address: '서울 강남구 테헤란로 1' },
  recipient: {},
  status: 'pending',
  settlement: { fee: 20000 },
  source: { type: 'manual' },
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
});

describe('finance logs and backup helpers', () => {
  it('creates fuel/mileage logs and summarizes efficiency by vehicle', () => {
    const fuel = createFuelLog(
      {
        date: '2026-07-16',
        liters: 20,
        amount: 32000,
        odometerKm: 10000,
        vehicle: 'Porter',
      },
      { id: 'fuel-1' },
    );
    const mileage = createMileageLog(
      {
        date: '2026-07-16',
        odometerKm: 10180,
        dailyDistanceKm: 180,
        vehicle: 'Porter',
      },
      { id: 'mileage-1' },
    );

    expect(fuel.pricePerLiter).toBe(1600);
    expect(
      summarizeEfficiencyByVehicle([fuel], [mileage], {
        defaultLabel: 'default',
      })[0].summary,
    ).toMatchObject({ kmPerLiter: 9, costPerKm: 178 });
  });

  it('exports profit CSV and validates backup restore envelopes', () => {
    const fuel = createFuelLog(
      { date: '2026-07-16', liters: 10, amount: 15000 },
      { id: 'fuel-1' },
    );
    const daily = summarizeDailyProfit([order('order-1')], [fuel], DEFAULT_ROUTELO_SETTINGS);
    expect(buildDailyProfitCsv(daily)).toContain('2026-07-16,20000,15000,5000,1');

    const json = buildBackupJson({
      exportedAt: '2026-07-16T00:00:00.000Z',
      orders: [order('order-1')],
      fuelLogs: [fuel],
      mileageLogs: [],
      contactLogs: [],
      settings: DEFAULT_ROUTELO_SETTINGS,
    });
    const parsed = parseBackup(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.backup.orders).toHaveLength(1);
  });

  it('escapes CSV cells containing commas, quotes and newlines', () => {
    const messy = [
      ['plain', 'plain'],
      ['a,b', '"a,b"'],
      ['say "hi"', '"say ""hi"""'],
      ['line\nbreak', '"line\nbreak"'],
      ['carriage\rreturn', '"carriage\rreturn"'],
    ] as const;
    for (const [input, expected] of messy) {
      const csv = buildDailyProfitCsv(
        new Map([
          [
            input,
            { revenue: 1, fuelCost: 0, net: 1, count: 1 } as never,
          ],
        ]),
      );
      expect(csv).toContain(expected);
    }
  });

  it('rejects malformed backups instead of poisoning app state', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ app: 'other' })).ok).toBe(false);
    // id만 있는 임의 객체는 주문으로 통과하면 안 된다.
    const junkOrders = JSON.stringify({
      app: 'routelo-android',
      schemaVersion: 1,
      orders: [{ id: 'x' }],
      fuelLogs: [],
      mileageLogs: [],
      settings: DEFAULT_ROUTELO_SETTINGS,
    });
    expect(parseBackup(junkOrders).ok).toBe(false);
  });

  it('normalizes partial settings so restore cannot crash the app', () => {
    const partial = JSON.stringify({
      app: 'routelo-android',
      schemaVersion: 1,
      orders: [],
      fuelLogs: [],
      mileageLogs: [],
      settings: {},
    });
    const parsed = parseBackup(partial);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // 빈 설정이 그대로 들어오면 appearance/route/notifications 접근이 터진다.
      expect(parsed.backup.settings.appearance).toBeDefined();
      expect(parsed.backup.settings.route).toBeDefined();
      expect(parsed.backup.settings.notifications).toBeDefined();
    }
  });

  it('fills missing proof photoUris from cross-platform backups', () => {
    const iosBackup = JSON.stringify({
      app: 'routelo-for-ios',
      schemaVersion: 1,
      orders: [
        {
          ...order('order-ios'),
          proofOfDelivery: { status: 'completed', recordedAt: 'now' },
        },
      ],
      fuelLogs: [],
      mileageLogs: [],
      settings: DEFAULT_ROUTELO_SETTINGS,
    });
    const parsed = parseBackup(iosBackup);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.backup.orders[0].proofOfDelivery?.photoUris).toEqual([]);
    }
  });
});

describe('notification planning', () => {
  it('plans strict deadline and event reminders without past notifications', () => {
    const plan = buildPlannedNotifications(
      [order('order-1')],
      DEFAULT_ROUTELO_SETTINGS.notifications,
      new Date('2026-07-16T01:00:00.000Z').getTime(),
    );
    expect(plan.map((item) => item.kind)).toEqual([
      'strictDeadline',
      'eventTime',
      'strictDeadline',
      'eventTime',
    ]);
  });
});
