import { MileageLog } from '../models';
import { normalizeVehicle } from './fuel';

export type MileageLogInput = {
  date: string;
  odometerKm: number;
  dailyDistanceKm?: number;
  vehicle?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateMileageLogInput(input: MileageLogInput): string[] {
  const errors: string[] = [];
  if (!DATE_RE.test(input.date)) errors.push('Mileage date must be YYYY-MM-DD.');
  if (!Number.isFinite(input.odometerKm) || input.odometerKm < 0) {
    errors.push('Odometer must be 0 or greater.');
  }
  if (
    input.dailyDistanceKm !== undefined &&
    (!Number.isFinite(input.dailyDistanceKm) || input.dailyDistanceKm < 0)
  ) {
    errors.push('Daily distance must be 0 or greater.');
  }
  return errors;
}

export function createMileageLog(
  input: MileageLogInput,
  opts: { id: string },
): MileageLog {
  const errors = validateMileageLogInput(input);
  if (errors.length) throw new Error(errors.join(' '));
  return {
    id: opts.id,
    date: input.date,
    odometerKm: input.odometerKm,
    dailyDistanceKm: input.dailyDistanceKm ?? 0,
    vehicle: normalizeVehicle(input.vehicle),
  };
}

export function applyMileageLogEdit(
  log: MileageLog,
  input: MileageLogInput,
): MileageLog {
  return { ...createMileageLog(input, { id: log.id }) };
}
