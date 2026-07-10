import {
  DEFAULT_TIMEZONE,
  DeliveryOrder,
  DOMAIN_SCHEMA_VERSION,
  ProductCategory,
} from './models';

export type LegacyDelivery = {
  id: string;
  orderVendor: string;
  orderVendorTel: string;
  deliveryVendor: string;
  deliveryVendorTel: string;
  productName: string;
  productQuantity: number;
  eventTime: string;
  deliveryDt: string;
  deliveryAddress: string;
  customerRequests: string;
  recipientTel: string;
  status: 'pending' | 'completed';
  distanceKm: number;
  fee: number;
  latitude: number;
  longitude: number;
};

const classifyProduct = (name: string): ProductCategory | undefined => {
  if (/축하|웨딩/.test(name)) return 'congratulation';
  if (/근조|장례/.test(name)) return 'condolence';
  if (/화분|관엽|난/.test(name)) return 'plant';
  return name ? 'other' : undefined;
};

const parseLegacyDateTime = (value: string) => {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/,
  );
  if (!match) return {};
  return {
    serviceDate: match[1],
    strictDeadlineAt: match[2]
      ? `${match[1]}T${match[2]}:00+09:00`
      : undefined,
  };
};

export function legacyDeliveryToOrder(
  legacy: LegacyDelivery,
  now = new Date().toISOString(),
): DeliveryOrder {
  const schedule = parseLegacyDateTime(legacy.deliveryDt);
  const eventAt =
    schedule.serviceDate && /^\d{2}:\d{2}$/.test(legacy.eventTime)
      ? `${schedule.serviceDate}T${legacy.eventTime}:00+09:00`
      : undefined;
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: legacy.id,
    orderingVendor: {
      name: legacy.orderVendor || undefined,
      telephone: legacy.orderVendorTel || undefined,
    },
    fulfillingVendor: {
      name: legacy.deliveryVendor || undefined,
      telephone: legacy.deliveryVendorTel || undefined,
    },
    product: {
      name: legacy.productName || undefined,
      category: classifyProduct(legacy.productName),
      quantity:
        Number.isInteger(legacy.productQuantity) &&
        legacy.productQuantity > 0
          ? legacy.productQuantity
          : undefined,
    },
    schedule: {
      serviceDate: schedule.serviceDate,
      timezone: DEFAULT_TIMEZONE,
      strictDeadlineAt: schedule.strictDeadlineAt,
      eventAt,
      timePrecision: schedule.strictDeadlineAt ? 'exact' : schedule.serviceDate ? 'date-only' : 'unknown',
      priority: eventAt ? 'critical' : 'normal',
      completedAt: legacy.status === 'completed' ? now : undefined,
    },
    destination: {
      address: legacy.deliveryAddress || undefined,
      latitude: Number.isFinite(legacy.latitude)
        ? legacy.latitude
        : undefined,
      longitude: Number.isFinite(legacy.longitude)
        ? legacy.longitude
        : undefined,
    },
    recipient: {
      telephone: legacy.recipientTel || undefined,
    },
    customerRequests: legacy.customerRequests || undefined,
    status: legacy.status,
    proofOfDelivery:
      legacy.status === 'completed'
        ? {
            status: 'completed',
            recordedAt: now,
            completedAt: now,
            photoUris: [],
            note: 'Migrated completed delivery.',
          }
        : undefined,
    settlement: {
      distanceKm: Number.isFinite(legacy.distanceKm)
        ? legacy.distanceKm
        : undefined,
      fee: Number.isFinite(legacy.fee) ? legacy.fee : undefined,
    },
    source: {
      type: legacy.id.startsWith('delivery-') ? 'sample' : 'migration',
      legacyId: legacy.id,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function orderToLegacyDelivery(order: DeliveryOrder): LegacyDelivery {
  const deadline = order.schedule.strictDeadlineAt;
  const deliveryTime = deadline?.match(/T(\d{2}:\d{2})/)?.[1];
  const eventTime = order.schedule.eventAt?.match(/T(\d{2}:\d{2})/)?.[1];
  return {
    id: order.id,
    orderVendor: order.orderingVendor.name || '',
    orderVendorTel: order.orderingVendor.telephone || '',
    deliveryVendor: order.fulfillingVendor.name || '',
    deliveryVendorTel: order.fulfillingVendor.telephone || '',
    productName: order.product.name || '',
    productQuantity: order.product.quantity || 0,
    eventTime: eventTime || '',
    deliveryDt: [order.schedule.serviceDate, deliveryTime]
      .filter(Boolean)
      .join(' '),
    deliveryAddress: order.destination.address || '',
    customerRequests: order.customerRequests || '',
    recipientTel: order.recipient.telephone || '',
    status: order.status === 'completed' ? 'completed' : 'pending',
    distanceKm: order.settlement.distanceKm || 0,
    fee: order.settlement.fee || 0,
    latitude: order.destination.latitude || 0,
    longitude: order.destination.longitude || 0,
  };
}
