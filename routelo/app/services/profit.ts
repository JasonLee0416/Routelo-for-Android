import { DeliveryOrder } from '../domain';
import { FuelLog } from '../models';
import { RouteloSettings } from '../settings';
import { calculateFeeByAddress } from './maps';

export type DailyProfitSummary = {
  revenue: number;
  fuelCost: number;
  net: number;
  count: number;
};

export type CalendarProfitDay = {
  date: string;
  revenue: number;
  fuelCost: number;
  net: number;
  deliveryCount: number;
  hasRevenue: boolean;
  hasFuelCost: boolean;
};

export type PeriodProfitSummary = {
  revenue: number;
  fuelCost: number;
  net: number;
  deliveryCount: number;
};

const emptySummary = (): DailyProfitSummary => ({
  revenue: 0,
  fuelCost: 0,
  net: 0,
  count: 0,
});

export function summarizeDailyProfit(
  orders: DeliveryOrder[],
  fuelLogs: FuelLog[],
  settings: RouteloSettings,
): Map<string, DailyProfitSummary> {
  const grouped = new Map<string, DailyProfitSummary>();

  orders.forEach((order) => {
    const date = order.schedule.serviceDate;
    if (!date) return;

    const current = grouped.get(date) || emptySummary();
    const savedFee = order.settlement.fee || 0;
    current.revenue +=
      savedFee > 0
        ? savedFee
        : calculateFeeByAddress(order.destination.address || '', settings);
    current.count += 1;
    grouped.set(date, current);
  });

  fuelLogs.forEach((log) => {
    const current = grouped.get(log.date) || emptySummary();
    current.fuelCost += log.amount;
    grouped.set(log.date, current);
  });

  grouped.forEach((summary) => {
    summary.net = summary.revenue - summary.fuelCost;
  });

  return grouped;
}

export function createCalendarProfitDays(
  orders: DeliveryOrder[],
  fuelLogs: FuelLog[],
  settings: RouteloSettings,
): CalendarProfitDay[] {
  return [...summarizeDailyProfit(orders, fuelLogs, settings).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, summary]) => ({
      date,
      revenue: summary.revenue,
      fuelCost: summary.fuelCost,
      net: summary.net,
      deliveryCount: summary.count,
      hasRevenue: summary.revenue > 0,
      hasFuelCost: summary.fuelCost > 0,
    }));
}

export type ProfitTrendPoint = {
  date: string;
  label: string;
  net: number;
};

// 달력 손익 추이 막대용 최근 N일. 실적이 있는 날짜만 날짜순으로 추린다
// (빈 날짜까지 그리면 막대가 뭉개져 추세가 안 보임).
// 예약된 미래 배송은 아직 '실적'이 아니다. 포함하면 다음 달 일정이 맨 오른쪽
// 막대가 되어 실제 최근 며칠을 창 밖으로 밀어낸다.
export function buildProfitTrend(
  daily: Map<string, DailyProfitSummary>,
  count = 8,
  today = new Date(),
): ProfitTrendPoint[] {
  const cutoff = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return [...daily.entries()]
    .filter(
      ([date, summary]) =>
        date <= cutoff && (summary.count > 0 || summary.fuelCost > 0),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-count)
    .map(([date, summary]) => ({
      date,
      label: date.slice(5).replace('-', '/'),
      net: summary.net,
    }));
}

export function summarizePeriodProfit(
  days: CalendarProfitDay[],
): PeriodProfitSummary {
  return days.reduce(
    (total, day) => ({
      revenue: total.revenue + day.revenue,
      fuelCost: total.fuelCost + day.fuelCost,
      net: total.net + day.net,
      deliveryCount: total.deliveryCount + day.deliveryCount,
    }),
    {
      revenue: 0,
      fuelCost: 0,
      net: 0,
      deliveryCount: 0,
    },
  );
}
