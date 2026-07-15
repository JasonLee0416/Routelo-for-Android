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
