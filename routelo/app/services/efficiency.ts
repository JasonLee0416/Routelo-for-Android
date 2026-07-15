import { FuelLog, MileageLog } from '../models';

export type EfficiencySummary = {
  totalDistanceKm: number;
  totalLiters: number;
  totalFuelCost: number;
  kmPerLiter: number | null;
  costPerKm: number | null;
};

export type VehicleEfficiency = {
  vehicle: string;
  summary: EfficiencySummary;
};

export function summarizeEfficiency(
  fuelLogs: FuelLog[],
  mileageLogs: MileageLog[],
): EfficiencySummary {
  const totalLiters = fuelLogs.reduce((sum, log) => sum + (log.liters || 0), 0);
  const totalFuelCost = fuelLogs.reduce((sum, log) => sum + (log.amount || 0), 0);
  const totalDistanceKm = mileageLogs.reduce(
    (sum, log) => sum + (log.dailyDistanceKm || 0),
    0,
  );
  return {
    totalDistanceKm,
    totalLiters,
    totalFuelCost,
    kmPerLiter:
      totalLiters > 0 ? Math.round((totalDistanceKm / totalLiters) * 10) / 10 : null,
    costPerKm:
      totalDistanceKm > 0 ? Math.round(totalFuelCost / totalDistanceKm) : null,
  };
}

export function summarizeEfficiencyByVehicle(
  fuelLogs: FuelLog[],
  mileageLogs: MileageLog[],
  opts: { defaultLabel: string },
): VehicleEfficiency[] {
  const label = (vehicle?: string) => vehicle?.trim() || opts.defaultLabel;
  const vehicles = new Set<string>();
  const fuelByVehicle = new Map<string, FuelLog[]>();
  const mileageByVehicle = new Map<string, MileageLog[]>();

  for (const log of fuelLogs) {
    const key = label(log.vehicle);
    vehicles.add(key);
    fuelByVehicle.set(key, [...(fuelByVehicle.get(key) ?? []), log]);
  }
  for (const log of mileageLogs) {
    const key = label(log.vehicle);
    vehicles.add(key);
    mileageByVehicle.set(key, [...(mileageByVehicle.get(key) ?? []), log]);
  }

  return [...vehicles].sort((a, b) => a.localeCompare(b)).map((vehicle) => ({
    vehicle,
    summary: summarizeEfficiency(
      fuelByVehicle.get(vehicle) ?? [],
      mileageByVehicle.get(vehicle) ?? [],
    ),
  }));
}
