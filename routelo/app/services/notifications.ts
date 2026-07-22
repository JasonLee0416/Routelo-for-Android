import * as Notifications from 'expo-notifications';

import { PlannedNotification } from './notificationPlan';

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  const status = current.granted
    ? current
    : await Notifications.requestPermissionsAsync();
  return Boolean(status.granted);
}

export async function syncScheduledNotifications(
  plan: PlannedNotification[],
): Promise<number> {
  // 예약할 알림이 없으면 권한부터 묻지 않는다. 첫 실행(주문 0건)에 아무 이유 없이
  // 알림 권한 팝업이 뜨던 문제.
  const pending = plan.filter((item) => item.fireAtMs > Date.now());
  if (!pending.length) return 0;
  const allowed = await ensureNotificationPermission();
  if (!allowed) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  let scheduled = 0;
  for (const item of pending) {
    // 한 건이 실패해도 나머지 알림까지 통째로 사라지지 않도록 개별 처리한다.
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: item.id,
        content: {
          title: item.title,
          body: item.body,
          data: { orderId: item.orderId, kind: item.kind },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(item.fireAtMs),
        },
      });
      scheduled += 1;
    } catch {
      // 개별 예약 실패는 건너뛴다.
    }
  }
  return scheduled;
}
