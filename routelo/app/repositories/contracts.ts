import {
  DeliveryOrder,
  ReceiptDocument,
  RoutePlan,
} from '../domain';
import { ContactLog, FuelLog, MileageLog } from '../models';

export interface DeliveryRepository {
  initialize(): Promise<void>;
  list(): Promise<DeliveryOrder[]>;
  get(id: string): Promise<DeliveryOrder | null>;
  save(order: DeliveryOrder): Promise<void>;
  saveAll(orders: DeliveryOrder[]): Promise<void>;
  remove(id: string): Promise<void>;
  listByServiceDate(date: string): Promise<DeliveryOrder[]>;
  listByDateRange(
    startDate: string,
    endDate: string,
  ): Promise<DeliveryOrder[]>;
}

export interface ReceiptRepository {
  list(): Promise<ReceiptDocument[]>;
  get(id: string): Promise<ReceiptDocument | null>;
  save(receipt: ReceiptDocument): Promise<void>;
  remove(id: string): Promise<void>;
  linkDelivery(receiptId: string, deliveryId: string): Promise<void>;
}

export interface RoutePlanRepository {
  getByServiceDate(date: string): Promise<RoutePlan | null>;
  save(plan: RoutePlan): Promise<void>;
  remove(serviceDate: string): Promise<void>;
}

export interface FuelLogRepository {
  list(): Promise<FuelLog[]>;
  save(log: FuelLog): Promise<void>;
  saveAll(logs: FuelLog[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface MileageLogRepository {
  list(): Promise<MileageLog[]>;
  save(log: MileageLog): Promise<void>;
  saveAll(logs: MileageLog[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ContactLogRepository {
  list(): Promise<ContactLog[]>;
  save(log: ContactLog): Promise<void>;
  saveAll(logs: ContactLog[]): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
