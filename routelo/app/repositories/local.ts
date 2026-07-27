import {
  ArchivedReceipt,
  compareCalendarItems,
  DeliveryOrder,
  DOMAIN_SCHEMA_VERSION,
  isIsoServiceDate,
  LegacyDelivery,
  legacyDeliveryToOrder,
  ReceiptDocument,
  RoutePlan,
  toCalendarDeliveryItem,
} from '../domain';
import {
  DeliveryRepository,
  ContactLogRepository,
  FuelLogRepository,
  KeyValueStore,
  MileageLogRepository,
  ReceiptRepository,
  RoutePlanRepository,
} from './contracts';
import { ContactLog, FuelLog, MileageLog } from '../models';

export const LEGACY_DELIVERY_KEY = '@routelo/md3-state/v1';
const DELIVERY_KEY = '@routelo/delivery-orders/v1';
const RECEIPT_KEY = '@routelo/receipt-documents/v1';
const RECEIPT_ARCHIVE_KEY = '@routelo/receipt-archive/v1';
const ROUTE_KEY = '@routelo/route-plans/v1';
const FUEL_KEY = '@routelo/fuel-logs/v1';
const MILEAGE_KEY = '@routelo/mileage-logs/v1';
const CONTACT_KEY = '@routelo/contact-logs/v1';
const MIGRATION_KEY = '@routelo/migrations/legacy-deliveries-v1';

const SAMPLE_IDS = new Set([
  'delivery-1',
  'delivery-2',
  'delivery-3',
  'delivery-4',
]);

type PersistedCollection<T> = {
  schemaVersion: number;
  records: T[];
};

type MigrationReport = {
  completedAt: string;
  sourceCount: number;
  migratedCount: number;
  skippedSampleCount: number;
  errors: Array<{ id?: string; message: string }>;
};

const readCollection = async <T>(
  store: KeyValueStore,
  key: string,
): Promise<T[]> => {
  const raw = await store.getItem(key);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as PersistedCollection<T>;
  return Array.isArray(parsed.records) ? parsed.records : [];
};

const writeCollection = async <T>(
  store: KeyValueStore,
  key: string,
  records: T[],
) => {
  const payload: PersistedCollection<T> = {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    records,
  };
  await store.setItem(key, JSON.stringify(payload));
};

export class LocalDeliveryRepository implements DeliveryRepository {
  constructor(private readonly store: KeyValueStore) {}

  async initialize() {
    if (await this.store.getItem(MIGRATION_KEY)) return;
    const legacyRaw = await this.store.getItem(LEGACY_DELIVERY_KEY);
    const report: MigrationReport = {
      completedAt: new Date().toISOString(),
      sourceCount: 0,
      migratedCount: 0,
      skippedSampleCount: 0,
      errors: [],
    };
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw) as {
          deliveries?: LegacyDelivery[];
        };
        const deliveries = Array.isArray(parsed.deliveries)
          ? parsed.deliveries
          : [];
        report.sourceCount = deliveries.length;
        const current = await this.list();
        const byId = new Map(current.map((order) => [order.id, order]));
        deliveries.forEach((legacy) => {
          try {
            if (SAMPLE_IDS.has(legacy.id)) {
              report.skippedSampleCount += 1;
              return;
            }
            if (!byId.has(legacy.id)) {
              byId.set(legacy.id, legacyDeliveryToOrder(legacy));
              report.migratedCount += 1;
            }
          } catch (error) {
            report.errors.push({
              id: legacy?.id,
              message:
                error instanceof Error ? error.message : 'Unknown migration error',
            });
          }
        });
        await this.saveAll([...byId.values()]);
      } catch (error) {
        report.errors.push({
          message:
            error instanceof Error ? error.message : 'Invalid legacy payload',
        });
      }
    }
    await this.store.setItem(MIGRATION_KEY, JSON.stringify(report));
  }

  list() {
    return readCollection<DeliveryOrder>(this.store, DELIVERY_KEY);
  }

  async get(id: string) {
    return (await this.list()).find((order) => order.id === id) || null;
  }

  async save(order: DeliveryOrder) {
    const records = await this.list();
    const index = records.findIndex((item) => item.id === order.id);
    if (index >= 0) records[index] = order;
    else records.push(order);
    await this.saveAll(records);
  }

  saveAll(orders: DeliveryOrder[]) {
    return writeCollection(this.store, DELIVERY_KEY, orders);
  }

  async remove(id: string) {
    await this.saveAll(
      (await this.list()).filter((order) => order.id !== id),
    );
  }

  async listByServiceDate(date: string) {
    if (!isIsoServiceDate(date)) return [];
    return this.listByDateRange(date, date);
  }

  async listByDateRange(startDate: string, endDate: string) {
    if (!isIsoServiceDate(startDate) || !isIsoServiceDate(endDate)) return [];
    const orders = (await this.list()).filter((order) => {
      const date = order.schedule.serviceDate;
      return Boolean(date && date >= startDate && date <= endDate);
    });
    return orders.sort((left, right) => {
      const leftItem = toCalendarDeliveryItem(left);
      const rightItem = toCalendarDeliveryItem(right);
      if (!leftItem || !rightItem) return left.id.localeCompare(right.id);
      return compareCalendarItems(leftItem, rightItem);
    });
  }
}

export class LocalReceiptRepository implements ReceiptRepository {
  constructor(private readonly store: KeyValueStore) {}

  list() {
    return readCollection<ReceiptDocument>(this.store, RECEIPT_KEY);
  }

  async get(id: string) {
    return (await this.list()).find((receipt) => receipt.id === id) || null;
  }

  async save(receipt: ReceiptDocument) {
    const records = await this.list();
    const index = records.findIndex((item) => item.id === receipt.id);
    if (index >= 0) records[index] = receipt;
    else records.push(receipt);
    await writeCollection(this.store, RECEIPT_KEY, records);
  }

  async remove(id: string) {
    await writeCollection(
      this.store,
      RECEIPT_KEY,
      (await this.list()).filter((receipt) => receipt.id !== id),
    );
  }

  async linkDelivery(receiptId: string, deliveryId: string) {
    const receipt = await this.get(receiptId);
    if (!receipt) throw new Error(`Receipt ${receiptId} not found`);
    await this.save({ ...receipt, linkedDeliveryId: deliveryId });
  }
}

export class LocalRoutePlanRepository implements RoutePlanRepository {
  constructor(private readonly store: KeyValueStore) {}

  async getByServiceDate(date: string) {
    return (
      (await readCollection<RoutePlan>(this.store, ROUTE_KEY)).find(
        (plan) => plan.serviceDate === date,
      ) || null
    );
  }

  async save(plan: RoutePlan) {
    const plans = await readCollection<RoutePlan>(this.store, ROUTE_KEY);
    const index = plans.findIndex(
      (item) => item.serviceDate === plan.serviceDate,
    );
    if (index >= 0) plans[index] = plan;
    else plans.push(plan);
    await writeCollection(this.store, ROUTE_KEY, plans);
  }

  async remove(serviceDate: string) {
    await writeCollection(
      this.store,
      ROUTE_KEY,
      (await readCollection<RoutePlan>(this.store, ROUTE_KEY)).filter(
        (plan) => plan.serviceDate !== serviceDate,
      ),
    );
  }
}

class LocalCollectionRepository<T extends { id: string }> {
  constructor(
    private readonly store: KeyValueStore,
    private readonly key: string,
  ) {}

  list() {
    return readCollection<T>(this.store, this.key);
  }

  async save(record: T) {
    const records = await this.list();
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) records[index] = record;
    else records.push(record);
    await this.saveAll(records);
  }

  saveAll(records: T[]) {
    return writeCollection(this.store, this.key, records);
  }

  async remove(id: string) {
    await this.saveAll((await this.list()).filter((record) => record.id !== id));
  }
}

export class LocalReceiptArchiveRepository extends LocalCollectionRepository<ArchivedReceipt> {
  constructor(store: KeyValueStore) {
    super(store, RECEIPT_ARCHIVE_KEY);
  }

  // 최신 촬영본이 먼저 오도록 capturedAt 내림차순 정렬해 반환한다.
  async listNewestFirst(): Promise<ArchivedReceipt[]> {
    const records = await this.list();
    return records.sort((left, right) =>
      right.capturedAt.localeCompare(left.capturedAt),
    );
  }
}

export class LocalFuelLogRepository
  extends LocalCollectionRepository<FuelLog>
  implements FuelLogRepository
{
  constructor(store: KeyValueStore) {
    super(store, FUEL_KEY);
  }
}

export class LocalMileageLogRepository
  extends LocalCollectionRepository<MileageLog>
  implements MileageLogRepository
{
  constructor(store: KeyValueStore) {
    super(store, MILEAGE_KEY);
  }
}

export class LocalContactLogRepository
  extends LocalCollectionRepository<ContactLog>
  implements ContactLogRepository
{
  constructor(store: KeyValueStore) {
    super(store, CONTACT_KEY);
  }
}
