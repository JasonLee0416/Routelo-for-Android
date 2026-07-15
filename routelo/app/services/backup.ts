import { DeliveryOrder } from '../domain';
import { ContactLog, FuelLog, MileageLog } from '../models';
import { RouteloSettings } from '../settings';

export const BACKUP_SCHEMA_VERSION = 1;

export type RouteloBackup = {
  app: 'routelo-android';
  schemaVersion: number;
  exportedAt: string;
  orders: DeliveryOrder[];
  fuelLogs: FuelLog[];
  mileageLogs: MileageLog[];
  contactLogs: ContactLog[];
  settings: RouteloSettings;
};

export type BackupInput = Omit<RouteloBackup, 'app' | 'schemaVersion'>;

export function buildBackup(input: BackupInput): RouteloBackup {
  return {
    app: 'routelo-android',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    ...input,
  };
}

export function buildBackupJson(input: BackupInput): string {
  return JSON.stringify(buildBackup(input), null, 2);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRecordArray = (value: unknown) =>
  Array.isArray(value) &&
  value.every((entry) => isObject(entry) && typeof entry.id === 'string');

export type ParseBackupResult =
  | { ok: true; backup: RouteloBackup }
  | { ok: false; error: string };

export function parseBackup(json: string): ParseBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON backup file.' };
  }

  if (!isObject(raw)) return { ok: false, error: 'Backup root must be an object.' };
  if (raw.app !== 'routelo-android' && raw.app !== 'routelo-for-ios') {
    return { ok: false, error: 'This is not a Routelo backup file.' };
  }
  if (
    typeof raw.schemaVersion !== 'number' ||
    raw.schemaVersion > BACKUP_SCHEMA_VERSION
  ) {
    return { ok: false, error: 'Unsupported backup schema version.' };
  }
  if (
    !isRecordArray(raw.orders) ||
    !isRecordArray(raw.fuelLogs) ||
    !isRecordArray(raw.mileageLogs)
  ) {
    return { ok: false, error: 'Backup contains invalid collection data.' };
  }
  if (raw.contactLogs !== undefined && !isRecordArray(raw.contactLogs)) {
    return { ok: false, error: 'Backup contains invalid contact logs.' };
  }
  if (!isObject(raw.settings)) {
    return { ok: false, error: 'Backup is missing settings.' };
  }

  return {
    ok: true,
    backup: {
      app: 'routelo-android',
      schemaVersion: raw.schemaVersion,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      orders: raw.orders as DeliveryOrder[],
      fuelLogs: raw.fuelLogs as FuelLog[],
      mileageLogs: raw.mileageLogs as MileageLog[],
      contactLogs: Array.isArray(raw.contactLogs)
        ? (raw.contactLogs as ContactLog[])
        : [],
      settings: raw.settings as RouteloSettings,
    },
  };
}
