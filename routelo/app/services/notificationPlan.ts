import { DeliveryOrder } from '../domain';
import { NotificationSettings } from '../settings';

export type PlannedNotification = {
  id: string;
  orderId: string;
  kind: 'strictDeadline' | 'eventTime';
  fireAtMs: number;
  title: string;
  body: string;
};

const toMs = (value?: string) => {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
};

export function buildPlannedNotifications(
  orders: DeliveryOrder[],
  settings: NotificationSettings,
  nowMs = Date.now(),
): PlannedNotification[] {
  const plan: PlannedNotification[] = [];
  for (const order of orders) {
    if (order.status !== 'pending' && order.status !== 'reviewRequired') continue;
    const title = order.product.name || order.destination.venueName || 'Routelo delivery';
    const address = order.destination.address || 'address not confirmed';
    const strictMs = toMs(order.schedule.strictDeadlineAt);
    if (settings.strictDeadlineEnabled && strictMs) {
      for (const lead of settings.strictDeadlineLeadMinutes) {
        const fireAtMs = strictMs - lead * 60_000;
        if (fireAtMs > nowMs) {
          plan.push({
            id: `routelo-${order.id}-strict-${lead}`,
            orderId: order.id,
            kind: 'strictDeadline',
            fireAtMs,
            title: `배송 엄수 ${lead}분 전`,
            body: `${title} · ${address}`,
          });
        }
      }
    }
    const eventMs = toMs(order.schedule.eventAt);
    if (settings.eventTimeEnabled && eventMs) {
      for (const lead of settings.eventLeadMinutes) {
        const fireAtMs = eventMs - lead * 60_000;
        if (fireAtMs > nowMs) {
          plan.push({
            id: `routelo-${order.id}-event-${lead}`,
            orderId: order.id,
            kind: 'eventTime',
            fireAtMs,
            title: `예식/행사 ${lead}분 전`,
            body: `${title} · ${address}`,
          });
        }
      }
    }
  }
  return plan.sort((a, b) => a.fireAtMs - b.fireAtMs);
}
