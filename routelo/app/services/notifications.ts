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
  const allowed = await ensureNotificationPermission();
  if (!allowed) return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();
  let scheduled = 0;
  for (const item of plan) {
    if (item.fireAtMs <= Date.now()) continue;
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
  }
  return scheduled;
}
