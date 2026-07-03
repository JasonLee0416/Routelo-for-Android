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
