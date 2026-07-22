import { DeliveryOrder } from '../domain';
import { ContactLog, FuelLog, MileageLog } from '../models';
import { mergeSettingsV2, RouteloSettings } from '../settings';

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

// 주문은 id만으로는 부족하다. 렌더/스케줄 경로가 최소한으로 요구하는 형태를
// 갖췄는지 확인한다(임의 JSON이 주문으로 통과해 앱을 깨뜨리던 문제).
const looksLikeOrder = (entry: Record<string, unknown>) =>
  typeof entry.id === 'string' &&
  typeof entry.status === 'string' &&
  isObject(entry.schedule);

const isOrderArray = (value: unknown) =>
  Array.isArray(value) && value.every((e) => isObject(e) && looksLikeOrder(e));

// 타 플랫폼(iOS) 백업이나 구버전은 선택 필드가 빠져 있을 수 있다. 소비 측에서
// `proofOfDelivery.photoUris.length` 같은 접근이 터지지 않도록 방어적으로 채운다.
function sanitizeOrder(entry: Record<string, unknown>): DeliveryOrder {
  const order = { ...entry } as unknown as DeliveryOrder;
  if (order.proofOfDelivery) {
    order.proofOfDelivery = {
      ...order.proofOfDelivery,
      photoUris: Array.isArray(order.proofOfDelivery.photoUris)
        ? order.proofOfDelivery.photoUris.filter(
            (uri): uri is string => typeof uri === 'string',
          )
        : [],
    };
  }
  return order;
}

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
    !isOrderArray(raw.orders) ||
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
      orders: (raw.orders as Record<string, unknown>[]).map(sanitizeOrder),
      fuelLogs: raw.fuelLogs as FuelLog[],
      mileageLogs: raw.mileageLogs as MileageLog[],
      contactLogs: Array.isArray(raw.contactLogs)
        ? (raw.contactLogs as ContactLog[])
        : [],
      // 부분 설정({} 포함)이 그대로 화면 상태로 들어가 크래시하던 문제.
      // 저장소와 동일한 정규화를 파싱 시점에 적용한다.
      settings: mergeSettingsV2(raw.settings),
    },
  };
}
