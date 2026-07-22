import { DailyProfitSummary } from './profit';

const csvCell = (value: string | number) => {
  const text = String(value);
  // \r 단독 개행도 행을 깨뜨리므로 함께 인용 처리한다.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function buildDailyProfitCsv(
  daily: Map<string, DailyProfitSummary>,
): string {
  const header = ['date', 'revenue', 'fuelCost', 'net', 'count'];
  const rows = [...daily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, summary]) => [
      date,
      summary.revenue,
      summary.fuelCost,
      summary.net,
      summary.count,
    ]);
  const totals = rows.reduce(
    (acc, [, revenue, fuelCost, net, count]) => ({
      revenue: acc.revenue + Number(revenue),
      fuelCost: acc.fuelCost + Number(fuelCost),
      net: acc.net + Number(net),
      count: acc.count + Number(count),
    }),
    { revenue: 0, fuelCost: 0, net: 0, count: 0 },
  );
  return [header, ...rows, ['total', totals.revenue, totals.fuelCost, totals.net, totals.count]]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
}
