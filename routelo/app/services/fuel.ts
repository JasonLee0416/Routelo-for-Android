import { FuelLog } from '../models';

export type FuelLogInput = {
  date: string;
  liters: number;
  pricePerLiter?: number;
  amount?: number;
  odometerKm?: number;
  vehicle?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeVehicle = (vehicle?: string): string | undefined => {
  const trimmed = vehicle?.trim();
  return trimmed ? trimmed : undefined;
};

export function validateFuelLogInput(input: FuelLogInput): string[] {
  const errors: string[] = [];
  if (!DATE_RE.test(input.date)) errors.push('Fuel date must be YYYY-MM-DD.');
  if (!Number.isFinite(input.liters) || input.liters <= 0) {
    errors.push('Fuel liters must be greater than 0.');
  }
  const hasPrice = Number.isFinite(input.pricePerLiter) && Number(input.pricePerLiter) > 0;
  const hasAmount = Number.isFinite(input.amount) && Number(input.amount) > 0;
  if (!hasPrice && !hasAmount) {
    errors.push('Either price per liter or total amount is required.');
  }
  if (input.odometerKm !== undefined && input.odometerKm < 0) {
    errors.push('Odometer must be 0 or greater.');
  }
  return errors;
}

function resolveMoney(input: FuelLogInput) {
  if (input.amount && input.amount > 0) {
    const amount = Math.round(input.amount);
    return {
      amount,
      pricePerLiter:
        input.pricePerLiter && input.pricePerLiter > 0
          ? Math.round(input.pricePerLiter)
          : Math.round((amount / input.liters) * 10) / 10,
    };
  }
  const pricePerLiter = input.pricePerLiter ?? 0;
  return {
    amount: Math.round(pricePerLiter * input.liters),
    pricePerLiter,
  };
}

export function createFuelLog(
  input: FuelLogInput,
  opts: { id: string },
): FuelLog {
  const errors = validateFuelLogInput(input);
  if (errors.length) throw new Error(errors.join(' '));
  const money = resolveMoney(input);
  return {
    id: opts.id,
    date: input.date,
    liters: input.liters,
    pricePerLiter: money.pricePerLiter,
    amount: money.amount,
    odometerKm: input.odometerKm ?? 0,
    vehicle: normalizeVehicle(input.vehicle),
  };
}

export function applyFuelLogEdit(log: FuelLog, input: FuelLogInput): FuelLog {
  return { ...createFuelLog(input, { id: log.id }) };
}
