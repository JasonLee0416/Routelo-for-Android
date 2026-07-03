import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { AccountState, EnergyType } from './account';
import { accountRepository } from './account/native';
import {
  DeliveryOrder,
  evaluateCalendarRisks,
  legacyDeliveryToOrder,
  orderToLegacyDelivery,
  toCalendarDeliveryItem,
} from './domain';
import {
  Delivery,
  FuelLog,
  OcrFieldKey,
  OcrFieldResult,
  OcrPipelineResult,
} from './models';
import { deliveryRepository } from './repositories/native';
import {
  calculateFeeByAddress,
  findDistrictByAddress,
  optimizeByNearestNeighbor,
} from './services/maps';
import { NAV_APP_LABEL, openNavigation } from './services/navigation';
import { summarizeDailyProfit } from './services/profit';
import { DEFAULT_ROUTELO_SETTINGS, NavApp, RouteloSettings } from './settings';
import { GYEONGGI_DISTRICTS, SEOUL_DISTRICTS } from './settings/districts';
import { settingsRepository } from './settings/native';
import {
  vendorDirectoryFor,
  VendorVerification,
  verifyVendor,
} from './vendor';
import {
  inspectCaptureQuality,
  OcrNoTextDetectedError,
  OcrRecognizerUnavailableError,
  runReceiptOcr,
} from './services/ocr';
import {
  createInitialLiveOcrSession,
  liveOcrChecklistItems,
  liveOcrIncompleteMessage,
  liveOcrReviewQuery,
  liveOcrScannerStepLabel,
  LiveOcrScanStage,
  summarizeLiveOcrSession,
  liveOcrStageTitle,
  mergeOcrResult,
  updateLiveOcrSession,
} from './services/liveOcr';

type TabKey =
  | 'home'
  | 'deliveries'
  | 'calendar'
  | 'route'
  | 'notifications'
  | 'settings';
type DeliveryFilter = 'all' | 'pending' | 'completed';

export type Palette = {
  primary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  navy: string;
  emphasis: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  outline: string;
  text: string;
  textMuted: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
};

const LIGHT: Palette = {
  primary: '#2457C5',
  primaryContainer: '#DCE6FF',
  onPrimaryContainer: '#0B2D6B',
  navy: '#17243C',
  emphasis: '#17243C',
  background: '#F5F7FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF2F7',
  outline: '#D9E0EA',
  text: '#172033',
  textMuted: '#657189',
  success: '#247A55',
  successBg: '#DDF3E8',
  warning: '#C75B12',
  warningBg: '#FFF0E4',
  danger: '#C93434',
  dangerBg: '#FDE7E7',
};

const DARK: Palette = {
  primary: '#6F9BF0',
  primaryContainer: '#26344F',
  onPrimaryContainer: '#DCE6FF',
  navy: '#E8EEF7',
  emphasis: '#243250',
  background: '#101827',
  surface: '#172033',
  surfaceAlt: '#243047',
  outline: '#31405A',
  text: '#F7FAFC',
  textMuted: '#A9B4C7',
  success: '#46B98A',
  successBg: '#143025',
  warning: '#E5934C',
  warningBg: '#3A2A1A',
  danger: '#E66A6A',
  dangerBg: '#3A1F1F',
};

const C = LIGHT;

type AppStyles = ReturnType<typeof makeStyles>;
type ThemeValue = { C: Palette; styles: AppStyles };

const ThemeContext = createContext<ThemeValue | null>(null);

const useTheme = (): ThemeValue =>
  useContext(ThemeContext) ?? { C: LIGHT, styles: makeStyles(LIGHT) };

// 목록에서의 민감정보 노출 제어(설정 privacy). 증거 보존과 무관하게 "표시"만 가린다.
type PrivacyValue = {
  showFullPhoneInList: boolean;
  showFullAddressInList: boolean;
};

const PrivacyContext = createContext<PrivacyValue>({
  showFullPhoneInList: false,
  showFullAddressInList: true,
});

const usePrivacy = (): PrivacyValue => useContext(PrivacyContext);

// 목록용 주소 마스킹: 앞 2개 토큰(시/구)만 남기고 이후를 가린다.
const maskAddressForList = (address: string): string => {
  const parts = address.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return address;
  return `${parts.slice(0, 2).join(' ')} ···`;
};

const formatWon = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;

const tabs: Array<{
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: 'home', label: '홈', icon: 'grid-outline', activeIcon: 'grid' },
  { key: 'deliveries', label: '배달', icon: 'cube-outline', activeIcon: 'cube' },
  {
    key: 'calendar',
    label: '일정',
    icon: 'calendar-outline',
    activeIcon: 'calendar',
  },
  { key: 'route', label: '동선', icon: 'map-outline', activeIcon: 'map' },
  {
    key: 'notifications',
    label: '알림',
    icon: 'notifications-outline',
    activeIcon: 'notifications',
  },
  { key: 'settings', label: '설정', icon: 'settings-outline', activeIcon: 'settings' },
];

function timeOf(value: string) {
  return value.split(' ')[1] || value;
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number);
  const total = hour * 60 + minute + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(
    total % 60,
  ).padStart(2, '0')}`;
}

function isEventDelivery(delivery: Delivery) {
  return Boolean(delivery.eventTime) || delivery.productName.includes('축하');
}

function priorityOf(delivery: Delivery) {
  if (isEventDelivery(delivery)) return 'urgent';
  if (delivery.distanceKm >= 10) return 'risk';
  return delivery.status === 'completed' ? 'completed' : 'normal';
}

function StatusBadge({ status }: { status: Delivery['status'] }) {
  const { C, styles } = useTheme();
  const completed = status === 'completed';
  return (
    <View style={[styles.badge, completed ? styles.successBadge : styles.waitBadge]}>
      <View
        style={[
          styles.badgeDot,
          { backgroundColor: completed ? C.success : C.primary },
        ]}
      />
      <Text
        style={[
          styles.badgeText,
          { color: completed ? C.success : C.primary },
        ]}
      >
        {completed ? '완료' : '배달 대기'}
      </Text>
    </View>
  );
}

function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  notificationCount,
  onNotificationPress,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  notificationCount?: number;
  onNotificationPress?: () => void;
}) {
  const { C, styles } = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.screenTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.screenSubtitle}>{subtitle}</Text>}
      </View>
      <Pressable style={styles.headerAction} onPress={onNotificationPress}>
        <Ionicons name="notifications-outline" size={23} color={C.navy} />
        {!!notificationCount && notificationCount > 0 && (
          <View style={styles.notificationCounter}>
            <Text style={styles.notificationCounterText}>{notificationCount}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function SectionHeader({
  title,
  caption,
  action,
}: {
  title: string;
  caption?: string;
  action?: React.ReactNode;
}) {
  const { C, styles } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <View>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!caption && <Text style={styles.sectionCaption}>{caption}</Text>}
      </View>
      {action}
    </View>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone = 'primary',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone?: 'primary' | 'success' | 'neutral' | 'warning';
}) {
  const { C, styles } = useTheme();
  const color =
    tone === 'success'
      ? C.success
      : tone === 'warning'
        ? C.warning
        : tone === 'neutral'
          ? C.textMuted
          : C.primary;
  const background =
    tone === 'success'
      ? C.successBg
      : tone === 'warning'
        ? C.warningBg
        : tone === 'neutral'
          ? C.surfaceAlt
          : C.primaryContainer;
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: background }]}>
        <Ionicons name={icon} size={21} color={color} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function TimeAlertCard({
  type,
  time,
  title,
  address,
}: {
  type: 'deadline' | 'event';
  time: string;
  title: string;
  address: string;
}) {
  const { C, styles } = useTheme();
  const { showFullAddressInList } = usePrivacy();
  const event = type === 'event';
  return (
    <View style={[styles.timeAlert, event ? styles.eventAlert : styles.deadlineAlert]}>
      <View style={[styles.timeIcon, { backgroundColor: event ? C.dangerBg : C.warningBg }]}>
        <Ionicons
          name={event ? 'calendar-outline' : 'alarm-outline'}
          size={22}
          color={event ? C.danger : C.warning}
        />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.timeAlertLabel, { color: event ? C.danger : C.warning }]}>
          {event ? '가장 가까운 예식 시간' : '가장 가까운 엄수 마감'}
        </Text>
        <View style={styles.timeAlertTitleRow}>
          <Text style={styles.timeAlertTime}>{time}</Text>
          <Text style={styles.timeAlertTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Text style={styles.timeAlertAddress} numberOfLines={1}>
          {showFullAddressInList ? address : maskAddressForList(address)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={C.textMuted} />
    </View>
  );
}

function ProgressCard({
  completed,
  total,
  distance,
}: {
  completed: number;
  total: number;
  distance: number;
}) {
  const { C, styles } = useTheme();
  const progress = total ? completed / total : 0;
  return (
    <View style={styles.progressCard}>
      <View style={styles.progressTop}>
        <View>
          <Text style={styles.progressLabel}>오늘의 업무 진행률</Text>
          <Text style={styles.progressValue}>{Math.round(progress * 100)}%</Text>
        </View>
        <View style={styles.progressSummary}>
          <Text style={styles.progressSummaryValue}>
            {completed}/{total}
          </Text>
          <Text style={styles.progressSummaryLabel}>완료</Text>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
      <View style={styles.progressMeta}>
        <View style={styles.metaItem}>
          <Ionicons name="navigate-outline" size={16} color={C.textMuted} />
          <Text style={styles.metaText}>남은 예상 거리 {distance.toFixed(1)}km</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="time-outline" size={16} color={C.textMuted} />
          <Text style={styles.metaText}>약 {Math.round(distance * 4.2)}분</Text>
        </View>
      </View>
    </View>
  );
}

function CompactDelivery({
  delivery,
  index,
  onPress,
}: {
  delivery: Delivery;
  index: number;
  onPress: () => void;
}) {
  const { C, styles } = useTheme();
  const { showFullAddressInList } = usePrivacy();
  const priority = priorityOf(delivery);
  return (
    <Pressable style={styles.compactDelivery} onPress={onPress}>
      <View style={styles.sequenceMarker}>
        <Text style={styles.sequenceMarkerText}>{index + 1}</Text>
      </View>
      <View style={styles.flex}>
        <View style={styles.rowBetween}>
          <Text style={styles.compactTime}>{timeOf(delivery.deliveryDt)}</Text>
          <StatusBadge status={delivery.status} />
        </View>
        <Text style={styles.compactTitle}>{delivery.productName}</Text>
        <Text style={styles.compactAddress} numberOfLines={1}>
          {showFullAddressInList
            ? delivery.deliveryAddress
            : maskAddressForList(delivery.deliveryAddress)}
        </Text>
        {priority === 'urgent' && (
          <View style={styles.inlineUrgent}>
            <Ionicons name="alert-circle" size={15} color={C.danger} />
            <Text style={styles.inlineUrgentText}>예식 {delivery.eventTime} · 시간 엄수</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color={C.textMuted} />
    </Pressable>
  );
}

function HomeScreen({
  deliveries,
  onDeliveryPress,
  onSeeAll,
  onNotifications,
}: {
  deliveries: Delivery[];
  onDeliveryPress: (delivery: Delivery) => void;
  onSeeAll: () => void;
  onNotifications: () => void;
}) {
  const { C, styles } = useTheme();
  const pending = deliveries.filter((item) => item.status === 'pending');
  const completed = deliveries.length - pending.length;
  const optimized = optimizeByNearestNeighbor(pending);
  const eventDelivery = pending.find(isEventDelivery);
  const deadline = pending[0];
  const remainingDistance = pending.reduce((sum, item) => sum + item.distanceKm, 0);

  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow="ROUTELO · 오늘의 운영"
        title="안녕하세요, 기사님"
        subtitle="마감 시간과 우선 배송을 먼저 확인하세요."
        notificationCount={3}
        onNotificationPress={onNotifications}
      />

      <View style={styles.metricsGrid}>
        <MetricCard icon="cube-outline" label="오늘 전체" value={`${deliveries.length}건`} />
        <MetricCard icon="checkmark-circle-outline" label="완료" value={`${completed}건`} tone="success" />
        <MetricCard icon="time-outline" label="남은 배달" value={`${pending.length}건`} tone="warning" />
      </View>

      <ProgressCard completed={completed} total={deliveries.length} distance={remainingDistance} />

      <SectionHeader title="시간 엄수 알림" caption="가장 가까운 중요 일정" />
      {!!deadline && (
        <TimeAlertCard
          type="deadline"
          time={timeOf(deadline.deliveryDt)}
          title={deadline.productName}
          address={deadline.deliveryAddress}
        />
      )}
      {!!eventDelivery && (
        <TimeAlertCard
          type="event"
          time={eventDelivery.eventTime}
          title={`${eventDelivery.productName} 예식`}
          address={eventDelivery.deliveryAddress}
        />
      )}

      <SectionHeader
        title="다음 배달"
        caption="최적화된 방문 순서"
        action={
          <Pressable style={styles.textButton} onPress={onSeeAll}>
            <Text style={styles.textButtonLabel}>전체 보기</Text>
            <Ionicons name="arrow-forward" size={16} color={C.primary} />
          </Pressable>
        }
      />
      <View style={styles.surfaceCard}>
        {optimized.slice(0, 3).map((delivery, index) => (
          <View key={delivery.id}>
            <CompactDelivery
              delivery={delivery}
              index={index}
              onPress={() => onDeliveryPress(delivery)}
            />
            {index < Math.min(optimized.length, 3) - 1 && <View style={styles.divider} />}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function DeliveryCard({
  delivery,
  onPress,
}: {
  delivery: Delivery;
  onPress: () => void;
}) {
  const { C, styles } = useTheme();
  const { showFullAddressInList } = usePrivacy();
  const urgent = isEventDelivery(delivery);
  const estimatedArrival = addMinutes(timeOf(delivery.deliveryDt), -18);
  return (
    <View style={styles.deliveryCard}>
      <View style={styles.rowBetween}>
        <View style={styles.deliveryCardTitleGroup}>
          <View style={[styles.destinationIcon, urgent && styles.destinationIconUrgent]}>
            <Ionicons name={urgent ? 'calendar' : 'location'} size={20} color={urgent ? C.danger : C.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.destinationName}>{delivery.productName}</Text>
            <Text style={styles.destinationVendor}>{delivery.orderVendor}</Text>
          </View>
        </View>
        <StatusBadge status={delivery.status} />
      </View>
      <Text style={styles.deliveryAddress}>
        {showFullAddressInList
          ? delivery.deliveryAddress
          : maskAddressForList(delivery.deliveryAddress)}
      </Text>

      <View style={styles.deliveryTimeGrid}>
        <View style={styles.deliveryTimeCell}>
          <Text style={styles.deliveryTimeCellLabel}>도착 예정</Text>
          <Text style={styles.deliveryTimeCellValue}>{estimatedArrival}</Text>
        </View>
        <View style={styles.deliveryTimeCell}>
          <Text style={styles.deliveryTimeCellLabel}>엄수 마감</Text>
          <Text style={[styles.deliveryTimeCellValue, styles.warningText]}>
            {timeOf(delivery.deliveryDt)}
          </Text>
        </View>
        <View style={styles.deliveryTimeCell}>
          <Text style={styles.deliveryTimeCellLabel}>예식 시간</Text>
          <Text style={[styles.deliveryTimeCellValue, urgent && styles.dangerText]}>
            {delivery.eventTime || '해당 없음'}
          </Text>
        </View>
      </View>

      <View style={styles.deliveryCardFooter}>
        <View style={styles.metaItem}>
          <Ionicons name="navigate-outline" size={16} color={C.textMuted} />
          <Text style={styles.metaText}>{delivery.distanceKm.toFixed(1)}km</Text>
        </View>
        <Pressable style={styles.outlinedButton} onPress={onPress}>
          <Text style={styles.outlinedButtonText}>상세 보기</Text>
          <Ionicons name="chevron-forward" size={16} color={C.primary} />
        </Pressable>
      </View>
    </View>
  );
}

function DeliveryListScreen({
  deliveries,
  onDeliveryPress,
  onNotifications,
}: {
  deliveries: Delivery[];
  onDeliveryPress: (delivery: Delivery) => void;
  onNotifications: () => void;
}) {
  const { C, styles } = useTheme();
  const [filter, setFilter] = useState<DeliveryFilter>('all');
  const filtered = deliveries.filter((delivery) =>
    filter === 'all' ? true : delivery.status === filter,
  );
  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow="TODAY · DELIVERY"
        title="오늘의 배달"
        subtitle={`${deliveries.length}건의 배달 일정을 관리합니다.`}
        notificationCount={3}
        onNotificationPress={onNotifications}
      />
      <View style={styles.filterSegment}>
        {([
          ['all', '전체'],
          ['pending', '대기'],
          ['completed', '완료'],
        ] as Array<[DeliveryFilter, string]>).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.filterItem, filter === key && styles.filterItemSelected]}
            onPress={() => setFilter(key)}
          >
            <Text style={[styles.filterText, filter === key && styles.filterTextSelected]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.deliveryList}>
        {filtered.map((delivery) => (
          <DeliveryCard
            key={delivery.id}
            delivery={delivery}
            onPress={() => onDeliveryPress(delivery)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function RouteScreen({
  deliveries,
  navApp,
  allowReorder,
  onDeliveryPress,
  onNotifications,
}: {
  deliveries: Delivery[];
  navApp: NavApp;
  allowReorder: boolean;
  onDeliveryPress: (delivery: Delivery) => void;
  onNotifications: () => void;
}) {
  const { C, styles } = useTheme();
  const pending = deliveries.filter((item) => item.status === 'pending');
  const pendingKey = pending.map((item) => item.id).join('|');
  const [order, setOrder] = useState<Delivery[]>(() =>
    optimizeByNearestNeighbor(pending),
  );

  // 배송 목록이 바뀌면 추천 순서로 다시 초기화한다.
  useEffect(() => {
    setOrder(optimizeByNearestNeighbor(pending));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const next = order[0];
  const totalDistance = order.reduce((sum, item) => sum + item.distanceKm, 0);

  const move = (index: number, direction: -1 | 1) => {
    setOrder((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const startNavigation = () => {
    if (!next) return;
    openNavigation(navApp, {
      name: next.deliveryAddress,
      latitude: next.latitude,
      longitude: next.longitude,
    }).catch(() => undefined);
  };

  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow="ROUTE · STACK"
        title="배달 동선"
        subtitle="배달 순서를 직접 정하고, 맨 위 목적지로 바로 안내받으세요."
        notificationCount={3}
        onNotificationPress={onNotifications}
      />
      {!!next && (
        <View style={styles.nextDestinationCard}>
          <View style={styles.nextDestinationHeader}>
            <View style={styles.nextBadge}>
              <Ionicons name="navigate" size={15} color={C.primary} />
              <Text style={styles.nextBadgeText}>다음 목적지</Text>
            </View>
            <Text style={styles.nextEta}>도착 예정 {addMinutes(timeOf(next.deliveryDt), -18)}</Text>
          </View>
          <Text style={styles.nextTitle}>{next.productName}</Text>
          <Text style={styles.nextAddress}>{next.deliveryAddress}</Text>
          <View style={styles.nextInfoRow}>
            <View style={styles.nextInfo}>
              <Text style={styles.nextInfoLabel}>남은 거리</Text>
              <Text style={styles.nextInfoValue}>{next.distanceKm.toFixed(1)}km</Text>
            </View>
            <View style={styles.nextInfoDivider} />
            <View style={styles.nextInfo}>
              <Text style={styles.nextInfoLabel}>엄수 마감</Text>
              <Text style={[styles.nextInfoValue, styles.warningText]}>
                {timeOf(next.deliveryDt)}
              </Text>
            </View>
            <View style={styles.nextInfoDivider} />
            <View style={styles.nextInfo}>
              <Text style={styles.nextInfoLabel}>예식 시간</Text>
              <Text style={[styles.nextInfoValue, isEventDelivery(next) && styles.dangerText]}>
                {next.eventTime || '-'}
              </Text>
            </View>
          </View>
          {isEventDelivery(next) && (
            <View style={styles.priorityNotice}>
              <Ionicons name="alert-circle" size={18} color={C.danger} />
              <Text style={styles.priorityNoticeText}>
                최우선 배송 · 예식 시작 전 설치 완료가 필요합니다.
              </Text>
            </View>
          )}
          <View style={styles.routeButtons}>
            <Pressable style={styles.secondaryButton} onPress={() => onDeliveryPress(next)}>
              <Text style={styles.secondaryButtonText}>배송 상세</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={startNavigation}>
              <Ionicons name="navigate-outline" size={18} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>
                {NAV_APP_LABEL[navApp]}(으)로 안내 시작
              </Text>
            </Pressable>
          </View>
        </View>
      )}
      <SectionHeader
        title="배달 순서"
        caption={`${order.length}개 목적지 · 총 ${totalDistance.toFixed(1)}km${
          allowReorder ? ' · 위/아래로 순서 조정' : ''
        }`}
      />
      <View style={styles.surfaceCard}>
        {order.map((delivery, index) => (
          <View key={delivery.id}>
            <View style={styles.routeStackRow}>
              <View style={styles.routeStackOrder}>
                <Text style={styles.routeStackOrderText}>{index + 1}</Text>
              </View>
              <Pressable
                style={styles.routeStackBody}
                onPress={() => onDeliveryPress(delivery)}
              >
                <Text style={styles.routeStackTitle} numberOfLines={1}>
                  {delivery.productName}
                </Text>
                <Text style={styles.routeStackAddress} numberOfLines={1}>
                  {delivery.deliveryAddress}
                </Text>
              </Pressable>
              {allowReorder && (
                <View style={styles.routeStackControls}>
                  <Pressable
                    disabled={index === 0}
                    onPress={() => move(index, -1)}
                    style={styles.routeStackArrow}
                  >
                    <Ionicons
                      name="chevron-up"
                      size={18}
                      color={index === 0 ? C.outline : C.primary}
                    />
                  </Pressable>
                  <Pressable
                    disabled={index === order.length - 1}
                    onPress={() => move(index, 1)}
                    style={styles.routeStackArrow}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={18}
                      color={index === order.length - 1 ? C.outline : C.primary}
                    />
                  </Pressable>
                </View>
              )}
            </View>
            {index < order.length - 1 && <View style={styles.divider} />}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

type CalendarMode = 'month' | 'week' | 'day';

const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const timeLabel = (value?: string) =>
  value?.match(/T(\d{2}:\d{2})/)?.[1] || '';

function CalendarScreen({
  orders,
  fuelLogs,
  settings,
  onDeliveryPress,
  onNotifications,
}: {
  orders: DeliveryOrder[];
  fuelLogs: FuelLog[];
  settings: RouteloSettings;
  onDeliveryPress: (delivery: Delivery) => void;
  onNotifications: () => void;
}) {
  const { C, styles } = useTheme();
  const { showFullAddressInList } = usePrivacy();
  const today = new Date();
  const [mode, setMode] = useState<CalendarMode>('month');
  const [cursor, setCursor] = useState(
    new Date(today.getFullYear(), today.getMonth(), today.getDate()),
  );
  const items = useMemo(
    () =>
      orders
        .map((order) => toCalendarDeliveryItem(order))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [orders],
  );
  const byDate = useMemo(() => {
    const grouped = new Map<string, typeof items>();
    items.forEach((item) => {
      grouped.set(item.date, [...(grouped.get(item.date) || []), item]);
    });
    grouped.forEach((value) =>
      value.sort((left, right) =>
        (
          left.deadlineAt ||
          left.startAt ||
          left.eventAt ||
          `${left.date}T23:59`
        ).localeCompare(
          right.deadlineAt ||
            right.startAt ||
            right.eventAt ||
            `${right.date}T23:59`,
        ),
      ),
    );
    return grouped;
  }, [items]);
  const selectedDate = formatDateKey(cursor);
  const selectedItems = byDate.get(selectedDate) || [];
  const calendarRisks = useMemo(() => evaluateCalendarRisks(items), [items]);
  const dailySummaries = useMemo(
    () => summarizeDailyProfit(orders, fuelLogs, settings),
    [fuelLogs, orders, settings],
  );
  const selectedSummary = dailySummaries.get(selectedDate) || {
    revenue: 0,
    fuelCost: 0,
    net: 0,
    count: 0,
  };
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthGridStart = new Date(monthStart);
  monthGridStart.setDate(1 - monthStart.getDay());
  const monthDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(monthGridStart);
    date.setDate(monthGridStart.getDate() + index);
    return date;
  });
  const weekStart = new Date(cursor);
  weekStart.setDate(cursor.getDate() - cursor.getDay());
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
  const visibleDays =
    mode === 'month' ? monthDays : mode === 'week' ? weekDays : [cursor];

  const move = (direction: number) => {
    const next = new Date(cursor);
    if (mode === 'month') next.setMonth(cursor.getMonth() + direction, 1);
    else next.setDate(cursor.getDate() + direction * (mode === 'week' ? 7 : 1));
    setCursor(next);
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.screenContent}>
      <ScreenHeader
        eyebrow="DELIVERY CALENDAR"
        title="배달 일정"
        subtitle="마감·예식·동선 시간을 분리해 확인합니다"
        notificationCount={3}
        onNotificationPress={onNotifications}
      />
      <View style={styles.calendarModeRow}>
        {(['month', 'week', 'day'] as CalendarMode[]).map((item) => (
          <Pressable
            key={item}
            style={[
              styles.calendarModeButton,
              mode === item && styles.calendarModeButtonActive,
            ]}
            onPress={() => setMode(item)}
          >
            <Text
              style={[
                styles.calendarModeText,
                mode === item && styles.calendarModeTextActive,
              ]}
            >
              {item === 'month' ? '월' : item === 'week' ? '주' : '일'}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.calendarCard}>
        <View style={styles.calendarToolbar}>
          <Pressable style={styles.iconButton} onPress={() => move(-1)}>
            <Ionicons name="chevron-back" size={20} color={C.navy} />
          </Pressable>
          <Text style={styles.calendarTitle}>
            {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
          </Text>
          <Pressable style={styles.iconButton} onPress={() => move(1)}>
            <Ionicons name="chevron-forward" size={20} color={C.navy} />
          </Pressable>
        </View>
        <View style={styles.calendarWeekHeader}>
          {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
            <Text key={day} style={styles.calendarWeekLabel}>
              {day}
            </Text>
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {visibleDays.map((date) => {
            const key = formatDateKey(date);
            const count = byDate.get(key)?.length || 0;
            const summary = dailySummaries.get(key);
            const selected = key === selectedDate;
            const outside =
              mode === 'month' && date.getMonth() !== cursor.getMonth();
            const urgent = (byDate.get(key) || []).some(
              (item) =>
                item.priority !== 'normal' ||
                calendarRisks.get(item.id)?.conflict ||
                calendarRisks.get(item.id)?.late,
            );
            return (
              <Pressable
                key={key}
                style={[
                  styles.calendarDay,
                  mode !== 'month' && styles.calendarDayWide,
                  selected && styles.calendarDaySelected,
                ]}
                onPress={() => setCursor(date)}
              >
                <Text
                  style={[
                    styles.calendarDayText,
                    outside && styles.calendarDayOutside,
                    selected && styles.calendarDayTextSelected,
                  ]}
                >
                  {date.getDate()}
                </Text>
                {false && count > 0 && (
                  <View
                    style={[
                      styles.calendarCount,
                      urgent && styles.calendarCountUrgent,
                    ]}
                  >
                    <Text style={styles.calendarCountText}>{count}</Text>
                  </View>
                )}
                {summary && (summary.revenue > 0 || summary.fuelCost > 0) && (
                  <View style={styles.calendarMoneyStack}>
                    <Text
                      style={[
                        styles.calendarNetText,
                        summary.net < 0 && styles.calendarNetTextNegative,
                        urgent && styles.calendarNetTextUrgent,
                      ]}
                      numberOfLines={1}
                    >
                      {summary.net >= 10000
                        ? `${Math.round(summary.net / 10000)}만`
                        : formatWon(summary.net)}
                    </Text>
                    <Text style={styles.calendarFuelText} numberOfLines={1}>
                      -{formatWon(summary.fuelCost)}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
      <SectionHeader
        title={`${selectedDate} 일정`}
        caption={`${selectedItems.length}건`}
      />
      <View style={styles.profitSummaryCard}>
        <View>
          <Text style={styles.profitSummaryLabel}>당일 순수익</Text>
          <Text
            style={[
              styles.profitSummaryValue,
              selectedSummary.net < 0 && styles.profitSummaryValueNegative,
            ]}
          >
            {formatWon(selectedSummary.net)}
          </Text>
        </View>
        <View style={styles.profitSummaryMeta}>
          <Text style={styles.profitSummaryMetaText}>
            배송 수수료 {formatWon(selectedSummary.revenue)}
          </Text>
          <Text style={styles.profitSummaryMetaText}>
            유류비 차감 {formatWon(selectedSummary.fuelCost)}
          </Text>
        </View>
      </View>
      {selectedItems.length === 0 ? (
        <View style={styles.calendarEmpty}>
          <Ionicons name="calendar-clear-outline" size={30} color={C.textMuted} />
          <Text style={styles.calendarEmptyTitle}>등록된 배달이 없습니다</Text>
          <Text style={styles.calendarEmptyText}>
            날짜만 인식된 OCR 일정도 이곳에 안전하게 표시됩니다.
          </Text>
        </View>
      ) : (
        selectedItems.map((item) => {
          const risk = calendarRisks.get(item.id);
          const order = orders.find(
            (entry) => entry.id === item.deliveryOrderId,
          );
          const delivery = order ? orderToLegacyDelivery(order) : undefined;
          const primaryTime =
            timeLabel(item.deadlineAt) ||
            timeLabel(item.startAt) ||
            timeLabel(item.eventAt);
          return (
            <Pressable
              key={item.id}
              style={[
                styles.calendarAgendaCard,
                risk?.conflict && styles.calendarAgendaCardConflict,
                risk?.late && styles.calendarAgendaCardLate,
              ]}
              onPress={() => delivery && onDeliveryPress(delivery)}
            >
              <View style={styles.calendarTimeColumn}>
                <Text
                  style={[
                    styles.calendarAgendaTime,
                    item.priority !== 'normal' && { color: C.danger },
                  ]}
                >
                  {primaryTime || '시간 미정'}
                </Text>
                <Text style={styles.calendarPrecision}>
                  {item.timePrecision === 'date-only'
                    ? '날짜만 확인'
                    : item.timePrecision === 'approximate'
                      ? '대략 시간'
                      : '확정 일정'}
                </Text>
              </View>
              <View style={styles.calendarAgendaBody}>
                <Text style={styles.calendarAgendaTitle}>{item.title}</Text>
                <Text style={styles.calendarAgendaAddress}>
                  {showFullAddressInList
                    ? item.address
                    : maskAddressForList(item.address)}
                </Text>
                <View style={styles.calendarMetaRow}>
                  {risk?.conflict && (
                    <Text style={styles.calendarConflictText}>일정 충돌</Text>
                  )}
                  {risk?.late && (
                    <Text style={styles.calendarLateText}>도착 지연 위험</Text>
                  )}
                  {!!item.deadlineAt && (
                    <Text style={styles.calendarUrgentText}>
                      엄수 {timeLabel(item.deadlineAt)}
                    </Text>
                  )}
                  {!!item.eventAt && (
                    <Text style={styles.calendarEventText}>
                      행사 {timeLabel(item.eventAt)}
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

type NotificationTone = 'danger' | 'warning' | 'info';

function NotificationCard({
  tone,
  title,
  body,
  time,
  icon,
}: {
  tone: NotificationTone;
  title: string;
  body: string;
  time: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { C, styles } = useTheme();
  const color = tone === 'danger' ? C.danger : tone === 'warning' ? C.warning : C.primary;
  const background =
    tone === 'danger' ? C.dangerBg : tone === 'warning' ? C.warningBg : C.primaryContainer;
  return (
    <View style={styles.notificationCard}>
      <View style={[styles.notificationIcon, { backgroundColor: background }]}>
        <Ionicons name={icon} size={21} color={color} />
      </View>
      <View style={styles.flex}>
        <View style={styles.rowBetween}>
          <Text style={[styles.notificationUrgency, { color }]}>
            {tone === 'danger' ? '긴급' : tone === 'warning' ? '주의' : '안내'}
          </Text>
          <Text style={styles.notificationTime}>{time}</Text>
        </View>
        <Text style={styles.notificationTitle}>{title}</Text>
        <Text style={styles.notificationBody}>{body}</Text>
      </View>
    </View>
  );
}

function NotificationsScreen() {
  const { C, styles } = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow="ALERT CENTER"
        title="알림"
        subtitle="긴급도가 높은 알림부터 표시합니다."
      />
      <View style={styles.notificationSummary}>
        <View>
          <Text style={styles.notificationSummaryLabel}>확인 필요한 알림</Text>
          <Text style={styles.notificationSummaryValue}>3건</Text>
        </View>
        <View style={styles.urgencyLegend}>
          <View style={[styles.legendDot, { backgroundColor: C.danger }]} />
          <Text style={styles.legendText}>긴급 1</Text>
          <View style={[styles.legendDot, { backgroundColor: C.warning }]} />
          <Text style={styles.legendText}>주의 1</Text>
        </View>
      </View>
      <SectionHeader title="오늘" />
      <View style={styles.notificationList}>
        <NotificationCard
          tone="danger"
          icon="calendar-outline"
          title="예식 시간 30분 전"
          body="축하 3단 화환 설치를 11:00 이전에 완료해야 합니다."
          time="10:30"
        />
        <NotificationCard
          tone="warning"
          icon="speedometer-outline"
          title="도착 지연 위험"
          body="송파구 목적지의 예상 도착 시간이 엄수 마감과 12분 차이입니다."
          time="10:18"
        />
        <NotificationCard
          tone="info"
          icon="swap-horizontal-outline"
          title="추천 동선이 변경되었습니다"
          body="교통 상황을 반영해 서초구 방문 순서가 2번으로 조정되었습니다."
          time="09:52"
        />
      </View>
      <SectionHeader title="이전 알림" />
      <NotificationCard
        tone="info"
        icon="checkmark-done-outline"
        title="첫 번째 배송 완료"
        body="강남구 학동로 배송이 정상적으로 완료되었습니다."
        time="09:14"
      />
    </ScrollView>
  );
}

function SettingRow({
  icon,
  title,
  caption,
  trailing,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  caption: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  const { C, styles } = useTheme();
  return (
    <Pressable style={styles.settingRow} onPress={onPress}>
      <View style={styles.settingIcon}>
        <Ionicons name={icon} size={21} color={C.primary} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingCaption}>{caption}</Text>
      </View>
      {trailing || <Ionicons name="chevron-forward" size={20} color={C.textMuted} />}
    </Pressable>
  );
}

function SettingsScreen({
  account,
  settings,
  onSettingsChange,
  onEditAccount,
}: {
  account?: AccountState;
  settings: RouteloSettings;
  onSettingsChange: (settings: RouteloSettings) => void;
  onEditAccount: () => void;
}) {
  const { C, styles } = useTheme();
  const [districtQuery, setDistrictQuery] = useState('');
  const [openRegions, setOpenRegions] = useState<{
    Seoul: boolean;
    Gyeonggi: boolean;
  }>({ Seoul: false, Gyeonggi: false });
  const normalizedQuery = districtQuery.trim().replace(/\s/g, '');
  const visibleSeoul = SEOUL_DISTRICTS.filter((district) =>
    district.replace(/\s/g, '').includes(normalizedQuery),
  );
  const visibleGyeonggi = GYEONGGI_DISTRICTS.filter((district) =>
    district.replace(/\s/g, '').includes(normalizedQuery),
  );

  const updateSettings = (next: RouteloSettings) => {
    onSettingsChange(next);
    settingsRepository.save(next).catch(() => undefined);
  };

  const updateDistrictFee = (district: string, value: string) => {
    const numeric = Number(value.replace(/[^\d]/g, ''));
    updateSettings({
      ...settings,
      fees: {
        ...settings.fees,
        districtFees: {
          ...settings.fees.districtFees,
          Seoul: {
            ...settings.fees.districtFees.Seoul,
            ...(SEOUL_DISTRICTS.includes(district as never)
              ? { [district]: Number.isFinite(numeric) ? numeric : 0 }
              : {}),
          },
          Gyeonggi: {
            ...settings.fees.districtFees.Gyeonggi,
            ...(GYEONGGI_DISTRICTS.includes(district as never)
              ? { [district]: Number.isFinite(numeric) ? numeric : 0 }
              : {}),
          },
        },
      },
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow="APP PREFERENCES"
        title="설정"
        subtitle="업무 알림과 경로 계산 방식을 관리합니다."
      />
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}>
          <Ionicons name="person" size={27} color={C.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.profileName}>
            {account?.profile.displayName || '업무 기사 프로필'}
          </Text>
          <Text style={styles.profileCaption}>
            {account?.profile.accountMode === 'guest'
              ? '게스트 모드 · 로컬 저장'
              : `${account?.vehicles[0]?.model || '차량 미등록'} · 회원 모드`}
          </Text>
        </View>
        <Pressable style={styles.iconButton} onPress={onEditAccount}>
          <Ionicons name="pencil-outline" size={19} color={C.primary} />
        </Pressable>
      </View>

      <SectionHeader title="알림 설정" />
      <View style={styles.settingsGroup}>
        <SettingRow
          icon="alarm-outline"
          title="엄수 마감 알림"
          caption={`${settings.notifications.strictDeadlineLeadMinutes.join('분 · ')}분 전에 알림`}
          trailing={
            <Switch
              value={settings.notifications.strictDeadlineEnabled}
              onValueChange={(enabled) =>
                updateSettings({
                  ...settings,
                  notifications: {
                    ...settings.notifications,
                    strictDeadlineEnabled: enabled,
                  },
                })
              }
              trackColor={{ true: C.primary }}
            />
          }
        />
        <View style={styles.divider} />
        <SettingRow
          icon="calendar-outline"
          title="예식 시간 알림"
          caption="예식 배송을 최우선으로 경고"
          trailing={
            <Switch
              value={settings.notifications.eventTimeEnabled}
              onValueChange={(enabled) =>
                updateSettings({
                  ...settings,
                  notifications: {
                    ...settings.notifications,
                    eventTimeEnabled: enabled,
                  },
                })
              }
              trackColor={{ true: C.primary }}
            />
          }
        />
        <View style={styles.divider} />
        <SettingRow
          icon="warning-outline"
          title="경로 변경·지연 알림"
          caption="도착 지연 가능성이 있을 때 알림"
          trailing={
            <Switch
              value={settings.notifications.delayRiskEnabled}
              onValueChange={(enabled) =>
                updateSettings({
                  ...settings,
                  notifications: {
                    ...settings.notifications,
                    delayRiskEnabled: enabled,
                  },
                })
              }
              trackColor={{ true: C.primary }}
            />
          }
        />
      </View>

      <SectionHeader title="경로 설정" />
      <View style={styles.settingsGroup}>
        <SettingRow icon="car-outline" title="이동 수단" caption="업무용 차량 · 자동차" />
        <View style={styles.divider} />
        <SettingRow
          icon="navigate-outline"
          title="내비게이션 앱"
          caption="경로 안내를 넘길 앱을 선택합니다"
        />
        <View style={styles.navAppOptions}>
          {(['tmap', 'kakao', 'naver'] as NavApp[]).map((app) => {
            const active = settings.route.navApp === app;
            return (
              <Pressable
                key={app}
                style={[styles.navAppOption, active && styles.navAppOptionActive]}
                onPress={() =>
                  updateSettings({
                    ...settings,
                    route: { ...settings.route, navApp: app },
                  })
                }
              >
                <Text
                  style={[
                    styles.navAppOptionText,
                    active && styles.navAppOptionTextActive,
                  ]}
                >
                  {NAV_APP_LABEL[app]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.divider} />
        <SettingRow
          icon="swap-vertical-outline"
          title="수동 순서 변경"
          caption="배송 순서를 직접 조정할 수 있습니다"
          trailing={
            <Switch
              value={settings.route.allowManualReorder}
              onValueChange={(enabled) =>
                updateSettings({
                  ...settings,
                  route: { ...settings.route, allowManualReorder: enabled },
                })
              }
              trackColor={{ true: C.primary }}
            />
          }
        />
      </View>

      <SectionHeader title="개인정보 보호" />
      <View style={styles.settingsGroup}>
        <SettingRow
          icon="image-outline"
          title="원본 인수증 보관"
          caption="OCR 검증을 위해 촬영 원본을 로컬에 보관합니다"
          trailing={
            <Switch
              value={settings.privacy.preserveOriginalReceiptImage}
              onValueChange={(enabled) =>
                updateSettings({
                  ...settings,
                  privacy: {
                    ...settings.privacy,
                    preserveOriginalReceiptImage: enabled,
                  },
                })
              }
              trackColor={{ true: C.primary }}
            />
          }
        />
        <View style={styles.divider} />
        <SettingRow
          icon="call-outline"
          title="목록에서 전화번호 표시"
          caption="민감정보 노출을 줄이려면 끄는 것을 권장합니다"
          trailing={
            <Switch
              value={settings.privacy.showFullPhoneInList}
              onValueChange={(enabled) =>
                updateSettings({
                  ...settings,
                  privacy: { ...settings.privacy, showFullPhoneInList: enabled },
                })
              }
              trackColor={{ true: C.primary }}
            />
          }
        />
        <View style={styles.divider} />
        <SettingRow
          icon="globe-outline"
          title="온라인 발주처 교차검증"
          caption="발주처 업체명만 온라인 장소검색으로 대조합니다. 수령인 정보는 전송하지 않습니다."
          trailing={
            <Switch
              value={settings.ocr.onlineVendorVerification}
              onValueChange={(enabled) =>
                updateSettings({
                  ...settings,
                  ocr: { ...settings.ocr, onlineVendorVerification: enabled },
                })
              }
              trackColor={{ true: C.primary }}
            />
          }
        />
      </View>

      <SectionHeader title="앱 설정" />
      <View style={styles.settingsGroup}>
        <SettingRow
          icon="color-palette-outline"
          title="화면 모드"
          caption={settings.appearance.themeMode === 'dark' ? '다크 모드 사용 중' : '라이트 모드 사용 중'}
          trailing={
            <Switch
              value={settings.appearance.themeMode === 'dark'}
              onValueChange={(enabled) =>
                updateSettings({
                  ...settings,
                  appearance: {
                    ...settings.appearance,
                    themeMode: enabled ? 'dark' : 'light',
                  },
                })
              }
              trackColor={{ true: C.primary }}
            />
          }
        />
        <View style={styles.divider} />
        <SettingRow icon="language-outline" title="언어" caption="한국어" />
        <View style={styles.divider} />
        <SettingRow icon="information-circle-outline" title="앱 정보" caption="RouteLO 1.0.0" />
      </View>
      <SectionHeader
        title="지역별 배달 수수료"
        caption="서울 25개 자치구와 경기도 31개 시군별 금액을 회사 정책에 맞게 설정합니다."
      />
      <View style={styles.districtFeePanel}>
        <TextInput
          value={districtQuery}
          onChangeText={setDistrictQuery}
          placeholder="지역 검색"
          placeholderTextColor={C.textMuted}
          style={styles.districtSearchInput}
        />
        {(['Seoul', 'Gyeonggi'] as const).map((region) => {
          const label = region === 'Seoul' ? '서울 지역' : '경기도 지역';
          const all =
            region === 'Seoul' ? SEOUL_DISTRICTS : GYEONGGI_DISTRICTS;
          const visible = region === 'Seoul' ? visibleSeoul : visibleGyeonggi;
          const fees = settings.fees.districtFees[region];
          const expanded = openRegions[region] || normalizedQuery.length > 0;
          return (
            <View key={region} style={styles.districtRegion}>
              <Pressable
                style={styles.districtRegionHeader}
                onPress={() =>
                  setOpenRegions((current) => ({
                    ...current,
                    [region]: !current[region],
                  }))
                }
              >
                <Text style={styles.districtFeeGroupTitle}>{label}</Text>
                <View style={styles.districtRegionRight}>
                  <Text style={styles.districtRegionCount}>
                    {normalizedQuery
                      ? `${visible.length}/${all.length}`
                      : `${all.length}개`}
                  </Text>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={C.textMuted}
                  />
                </View>
              </Pressable>
              {expanded &&
                visible.map((district) => (
                  <View key={district} style={styles.districtFeeRow}>
                    <Text style={styles.districtFeeName}>{district}</Text>
                    <TextInput
                      value={String(fees[district] || 0)}
                      onChangeText={(value) => updateDistrictFee(district, value)}
                      keyboardType="number-pad"
                      placeholder="15000"
                      placeholderTextColor={C.textMuted}
                      style={styles.districtFeeInput}
                    />
                    <Text style={styles.districtFeeUnit}>원</Text>
                  </View>
                ))}
              {expanded && normalizedQuery.length > 0 && !visible.length && (
                <Text style={styles.districtEmptyText}>검색 결과가 없습니다</Text>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function OnboardingModal({
  visible,
  initial,
  onComplete,
}: {
  visible: boolean;
  initial?: AccountState;
  onComplete: (state: AccountState) => void;
}) {
  const { C, styles } = useTheme();
  const [mode, setMode] = useState<'choice' | 'member'>(
    initial?.profile.accountMode === 'member' ? 'member' : 'choice',
  );
  const [displayName, setDisplayName] = useState(
    initial?.profile.displayName || '',
  );
  const [email, setEmail] = useState(initial?.profile.email || '');
  const [password, setPassword] = useState('');
  const [vehicleModel, setVehicleModel] = useState(
    initial?.vehicles[0]?.model || '',
  );
  const [energyType, setEnergyType] = useState<EnergyType>(
    initial?.vehicles[0]?.energyType || 'diesel',
  );
  const [capacity, setCapacity] = useState(
    String(
      initial?.vehicles[0]?.tankCapacityLiters ||
        initial?.vehicles[0]?.batteryCapacityKwh ||
        '',
    ),
  );

  useEffect(() => {
    if (!visible) return;
    setMode(initial?.profile.accountMode === 'member' ? 'member' : 'choice');
    setDisplayName(initial?.profile.displayName || '');
    setEmail(initial?.profile.email || '');
    setPassword('');
    setVehicleModel(initial?.vehicles[0]?.model || '');
    setEnergyType(initial?.vehicles[0]?.energyType || 'diesel');
    setCapacity(
      String(
        initial?.vehicles[0]?.tankCapacityLiters ||
          initial?.vehicles[0]?.batteryCapacityKwh ||
          '',
      ),
    );
  }, [initial, visible]);

  const saveGuest = () => {
    const now = new Date().toISOString();
    onComplete({
      profile: {
        schemaVersion: 1,
        id: initial?.profile.id || `guest-${Date.now()}`,
        accountMode: 'guest',
        plan: 'guest',
        status: 'active',
        displayName: displayName.trim() || '게스트 기사',
        createdAt: initial?.profile.createdAt || now,
        updatedAt: now,
      },
      vehicles: initial?.vehicles || [],
    });
  };

  const saveMember = () => {
    if (!displayName.trim() || !email.includes('@')) {
      Alert.alert('가입 정보 확인', '이름과 올바른 이메일을 입력해주세요.');
      return;
    }
    if (!initial && password.length < 8) {
      Alert.alert('비밀번호 확인', '비밀번호는 8자 이상 입력해주세요.');
      return;
    }
    if (!vehicleModel.trim()) {
      Alert.alert('차량 정보 확인', '업무 차량의 차종을 입력해주세요.');
      return;
    }
    const now = new Date().toISOString();
    const userId = initial?.profile.id || `member-${Date.now()}`;
    const numericCapacity = Number(capacity);
    const vehicleId = initial?.vehicles[0]?.id || `vehicle-${Date.now()}`;
    const state: AccountState = {
      profile: {
        schemaVersion: 1,
        id: userId,
        accountMode: 'member',
        plan: initial?.profile.plan === 'premium' ? 'premium' : 'free',
        status: 'active',
        displayName: displayName.trim(),
        email: email.trim(),
        primaryVehicleId: vehicleId,
        createdAt: initial?.profile.createdAt || now,
        updatedAt: now,
      },
      vehicles: [
        {
          schemaVersion: 1,
          id: vehicleId,
          userId,
          nickname: '업무 차량',
          model: vehicleModel.trim(),
          vehicleType: 'truck',
          energyType,
          tankCapacityLiters:
            energyType !== 'electric' && numericCapacity > 0
              ? numericCapacity
              : undefined,
          batteryCapacityKwh:
            energyType === 'electric' && numericCapacity > 0
              ? numericCapacity
              : undefined,
          isPrimary: true,
        },
      ],
    };
    setPassword('');
    onComplete(state);
  };

  return (
    <Modal visible={visible} animationType="slide">
      <SafeAreaView style={styles.onboardingApp}>
        <ScrollView contentContainerStyle={styles.onboardingContent}>
          <View style={styles.onboardingBrand}>
            <View style={styles.onboardingLogo}>
              <Ionicons name="navigate" size={30} color="#FFFFFF" />
            </View>
            <Text style={styles.onboardingTitle}>RouteLO 시작하기</Text>
            <Text style={styles.onboardingSubtitle}>
              기사님의 배달 기록과 수익 분석 방식을 선택해주세요.
            </Text>
          </View>
          {mode === 'choice' ? (
            <>
              <Pressable style={styles.onboardingChoice} onPress={saveGuest}>
                <Ionicons name="phone-portrait-outline" size={25} color={C.primary} />
                <View style={styles.flex}>
                  <Text style={styles.onboardingChoiceTitle}>비회원으로 시작</Text>
                  <Text style={styles.onboardingChoiceText}>
                    가입 없이 기기 내부에 배달·주유 기록을 저장합니다.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={C.textMuted} />
              </Pressable>
              <Pressable
                style={styles.onboardingChoice}
                onPress={() => setMode('member')}
              >
                <Ionicons name="person-circle-outline" size={27} color={C.primary} />
                <View style={styles.flex}>
                  <Text style={styles.onboardingChoiceTitle}>회원으로 시작</Text>
                  <Text style={styles.onboardingChoiceText}>
                    프로필과 업무 차량을 등록하고 계정 기반 기능을 준비합니다.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={C.textMuted} />
              </Pressable>
            </>
          ) : (
            <View style={styles.onboardingForm}>
              <Text style={styles.onboardingSectionTitle}>회원 프로필</Text>
              <TextInput
                style={styles.onboardingInput}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="기사님 이름 또는 닉네임"
                placeholderTextColor="#6B7280"
              />
              <TextInput
                style={styles.onboardingInput}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="이메일"
                placeholderTextColor="#6B7280"
              />
              {!initial && (
                <TextInput
                  style={styles.onboardingInput}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="비밀번호 8자 이상"
                  placeholderTextColor="#6B7280"
                />
              )}
              <Text style={styles.onboardingSectionTitle}>업무 차량</Text>
              <TextInput
                style={styles.onboardingInput}
                value={vehicleModel}
                onChangeText={setVehicleModel}
                placeholder="차종 예: 현대 포터2"
                placeholderTextColor="#6B7280"
              />
              <View style={styles.energyRow}>
                {(['gasoline', 'diesel', 'lpg', 'hybrid', 'electric'] as EnergyType[]).map(
                  (fuel) => (
                    <Pressable
                      key={fuel}
                      style={[
                        styles.energyChip,
                        energyType === fuel && styles.energyChipActive,
                      ]}
                      onPress={() => setEnergyType(fuel)}
                    >
                      <Text
                        style={[
                          styles.energyChipText,
                          energyType === fuel && styles.energyChipTextActive,
                        ]}
                      >
                        {fuel === 'gasoline'
                          ? '휘발유'
                          : fuel === 'diesel'
                            ? '경유'
                            : fuel === 'lpg'
                              ? 'LPG'
                              : fuel === 'hybrid'
                                ? '하이브리드'
                                : '전기'}
                      </Text>
                    </Pressable>
                  ),
                )}
              </View>
              <TextInput
                style={styles.onboardingInput}
                value={capacity}
                onChangeText={setCapacity}
                keyboardType="decimal-pad"
                placeholder={
                  energyType === 'electric'
                    ? '배터리 용량(kWh)'
                    : '연료탱크 용량(L)'
                }
                placeholderTextColor="#6B7280"
              />
              <Text style={styles.onboardingPrivacy}>
                이 정보는 기사님의 배송 수익과 차량 운영비를 더 정확하게 분석하기
                위해 사용됩니다. 필요한 정보만 기기에 저장하며 비밀번호는 이
                프로필에 저장하지 않습니다.
              </Text>
              <Pressable style={styles.scanPrimaryButton} onPress={saveMember}>
                <Text style={styles.scanPrimaryButtonText}>
                  {initial ? '프로필 저장' : '회원 정보 설정 완료'}
                </Text>
              </Pressable>
              {!initial && (
                <Pressable
                  style={styles.scanSecondaryButton}
                  onPress={() => setMode('choice')}
                >
                  <Text style={styles.scanSecondaryButtonText}>이전으로</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function DeliveryDetailSheet({
  delivery,
  visible,
  onClose,
  onToggle,
}: {
  delivery?: Delivery;
  visible: boolean;
  onClose: () => void;
  onToggle: () => void;
}) {
  const { C, styles } = useTheme();
  const insets = useSafeAreaInsets();
  if (!delivery) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.bottomSheet, { paddingBottom: 28 + insets.bottom }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetEyebrow}>배송 상세</Text>
              <Text style={styles.sheetTitle}>{delivery.productName}</Text>
            </View>
            <Pressable style={styles.iconButton} onPress={onClose}>
              <Ionicons name="close" size={22} color={C.text} />
            </Pressable>
          </View>
          <StatusBadge status={delivery.status} />
          <View style={styles.sheetAddress}>
            <Ionicons name="location-outline" size={20} color={C.primary} />
            <Text style={styles.sheetAddressText}>{delivery.deliveryAddress}</Text>
          </View>
          <View style={styles.sheetTimeGrid}>
            <View style={styles.sheetTimeItem}>
              <Text style={styles.sheetTimeLabel}>엄수 마감</Text>
              <Text style={[styles.sheetTimeValue, styles.warningText]}>
                {timeOf(delivery.deliveryDt)}
              </Text>
            </View>
            <View style={styles.sheetTimeItem}>
              <Text style={styles.sheetTimeLabel}>예식 시간</Text>
              <Text style={[styles.sheetTimeValue, isEventDelivery(delivery) && styles.dangerText]}>
                {delivery.eventTime || '-'}
              </Text>
            </View>
            <View style={styles.sheetTimeItem}>
              <Text style={styles.sheetTimeLabel}>수량</Text>
              <Text style={styles.sheetTimeValue}>{delivery.productQuantity}개</Text>
            </View>
          </View>
          <View style={styles.sheetInfoBlock}>
            <Text style={styles.sheetInfoLabel}>요청사항</Text>
            <Text style={styles.sheetInfoText}>{delivery.customerRequests}</Text>
          </View>
          <View style={styles.sheetActions}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => Linking.openURL(`tel:${delivery.recipientTel}`)}
            >
              <Ionicons name="call-outline" size={18} color={C.primary} />
              <Text style={styles.secondaryButtonText}>수령인 전화</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={onToggle}>
              <Ionicons
                name={delivery.status === 'completed' ? 'refresh-outline' : 'checkmark'}
                size={18}
                color="#FFFFFF"
              />
              <Text style={styles.primaryButtonText}>
                {delivery.status === 'completed' ? '대기로 변경' : '배송 완료'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type ScanStage = LiveOcrScanStage;

const OCR_FIELD_ICONS: Record<OcrFieldKey, keyof typeof Ionicons.glyphMap> = {
  orderingVendorName: 'storefront-outline',
  orderingVendorTel: 'call-outline',
  fulfillingVendorName: 'business-outline',
  fulfillingVendorTel: 'call-outline',
  productName: 'flower-outline',
  productQuantity: 'layers-outline',
  ribbonText: 'ribbon-outline',
  deliveryDate: 'calendar-outline',
  deliveryWindowStart: 'play-circle-outline',
  deliveryWindowEnd: 'stop-circle-outline',
  strictTime: 'alarm-outline',
  eventTime: 'time-outline',
  venueName: 'business-outline',
  deliveryAddress: 'location-outline',
  recipientName: 'person-outline',
  recipientTel: 'call-outline',
  memo: 'document-text-outline',
};

function ConfidenceBadge({ field }: { field: OcrFieldResult }) {
  const { C, styles } = useTheme();
  const confirmed = field.status === 'confirmed';
  const review = field.status === 'review';
  const color = confirmed ? C.success : review ? C.warning : C.danger;
  const background = confirmed ? C.successBg : review ? C.warningBg : C.dangerBg;
  return (
    <View style={[styles.confidenceBadge, { backgroundColor: background }]}>
      <Ionicons
        name={confirmed ? 'checkmark-circle' : review ? 'help-circle' : 'warning'}
        size={14}
        color={color}
      />
      <Text style={[styles.confidenceText, { color }]}>{field.confidence}%</Text>
    </View>
  );
}

function QualityMeter({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { C, styles } = useTheme();
  const color = value >= 80 ? C.success : value >= 60 ? C.warning : C.danger;
  return (
    <View style={styles.qualityRow}>
      <View style={styles.qualityLabelGroup}>
        <Ionicons name={icon} size={17} color={color} />
        <Text style={styles.qualityLabel}>{label}</Text>
      </View>
      <View style={styles.qualityTrack}>
        <View style={[styles.qualityFill, { width: `${value}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.qualityValue, { color }]}>{value}</Text>
    </View>
  );
}

function LiveScanChecklist({
  session,
}: {
  session: ReturnType<typeof createInitialLiveOcrSession>;
}) {
  const { C, styles } = useTheme();
  const summary = summarizeLiveOcrSession(session);
  const checklist = liveOcrChecklistItems(session);
  return (
    <View style={styles.liveChecklist}>
      <View style={styles.liveChecklistHeader}>
        <Text style={styles.liveChecklistTitle}>필수 인식 항목</Text>
        <Text style={styles.liveChecklistMeta}>{summary.lockedCount}/{summary.totalCount}</Text>
      </View>
      {checklist.map((field) => {
        return (
          <View
            key={field.id}
            style={[
              styles.liveChecklistItem,
              field.locked ? styles.liveChecklistItemLocked : undefined,
              field.candidate ? styles.liveChecklistItemCandidate : undefined,
            ]}
          >
            <View
              style={[
                styles.liveChecklistIcon,
                {
                  backgroundColor: field.locked
                    ? C.successBg
                    : field.candidate
                      ? C.warningBg
                      : C.surfaceAlt,
                },
              ]}
            >
              <Ionicons
                name={field.locked ? 'checkmark-circle' : 'close-circle-outline'}
                size={19}
                color={field.locked ? C.success : field.candidate ? C.warning : C.textMuted}
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.liveChecklistLabel}>{field.label}</Text>
              <Text style={styles.liveChecklistValue} numberOfLines={1}>
                {field.detail}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function OcrScannerModal({
  visible,
  settings,
  onClose,
  onRegister,
}: {
  visible: boolean;
  settings: RouteloSettings;
  onClose: () => void;
  onRegister: (delivery: Delivery) => void;
}) {
  const { C, styles } = useTheme();
  const [stage, setStage] = useState<ScanStage>('capture');
  const [imageUri, setImageUri] = useState<string>();
  const [assetInfo, setAssetInfo] = useState<{ width?: number; height?: number; fileSize?: number }>({});
  const [result, setResult] = useState<OcrPipelineResult>();
  const [aggregateResult, setAggregateResult] = useState<OcrPipelineResult>();
  const [fields, setFields] = useState<OcrFieldResult[]>([]);
  const [vendorCheck, setVendorCheck] = useState<VendorVerification>();
  const [liveSession, setLiveSession] = useState(createInitialLiveOcrSession);
  const liveSummary = summarizeLiveOcrSession(liveSession);

  const reset = () => {
    setStage('capture');
    setImageUri(undefined);
    setAssetInfo({});
    setResult(undefined);
    setAggregateResult(undefined);
    setFields([]);
    setVendorCheck(undefined);
    setLiveSession(createInitialLiveOcrSession());
  };

  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  const selectImage = async (camera: boolean) => {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('권한 필요', '인수증을 촬영하거나 불러오려면 사진 접근 권한이 필요합니다.');
      return;
    }
    const picked = camera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1,
          allowsEditing: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 1,
          allowsEditing: false,
        });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    const info = { width: asset.width, height: asset.height, fileSize: asset.fileSize };
    setImageUri(asset.uri);
    setAssetInfo(info);
    setResult({
      engine: 'fixture',
      rawText: '',
      fields: [],
      documentConfidence: 0,
      quality: inspectCaptureQuality(info),
      processingMs: 0,
      variantsCompared: 0,
      unmapped: [],
    });
    setStage('quality');
  };

  const verifyForReview = (reviewFields: OcrFieldResult[]) => {
    const { vendorName, vendorPhone } = liveOcrReviewQuery(reviewFields);
    setVendorCheck(undefined);
    if (!vendorName) return;
    verifyVendor(vendorDirectoryFor(settings), vendorName, {
      ocrPhone: vendorPhone,
    })
      .then((verification) =>
        verification.status === 'skipped' ? undefined : setVendorCheck(verification),
      )
      .catch(() => undefined);
  };

  const analyze = async () => {
    if (result && !result.quality.passed) {
      Alert.alert('재촬영 권장', result.quality.messages[0] || '촬영 품질을 확인해주세요.');
      return;
    }
    setStage('processing');
    setVendorCheck(undefined);
    try {
      const next = await runReceiptOcr({ ...assetInfo, uri: imageUri });
      const merged = mergeOcrResult(aggregateResult, next);
      const nextSession = updateLiveOcrSession(liveSession, next);
      setAggregateResult(merged);
      setLiveSession(nextSession);
      setResult(merged);
      setFields(merged.fields);
      if (nextSession.readyForReview) {
        setStage('review');
        verifyForReview(merged.fields);
      } else {
        setStage('capture');
        Alert.alert(
          '프레임 누적 완료',
          liveOcrIncompleteMessage(nextSession),
        );
      }
    } catch (error) {
      setResult(aggregateResult);
      setFields(aggregateResult?.fields ?? []);
      setStage('capture');
      Alert.alert(
        'OCR 인식 준비 중',
        error instanceof OcrRecognizerUnavailableError || error instanceof OcrNoTextDetectedError
          ? error.message
          : '인수증을 분석하지 못했습니다. 다시 촬영해 주세요.',
      );
    }
  };

  const updateField = (key: OcrFieldKey, value: string) => {
    setFields((current) =>
      current.map((item) =>
        item.key === key
          ? {
              ...item,
              value,
              rawValue: item.rawValue || item.value,
              confidence: value ? Math.max(item.confidence, 85) : 0,
              status: value ? 'confirmed' : 'missing',
              extractionMethod: 'manual',
              validationErrors: [],
            }
          : item,
      ),
    );
  };

  const valueOf = (key: OcrFieldKey) => fields.find((item) => item.key === key)?.value || '';

  const register = () => {
    if (!result?.rawText.trim() || fields.length === 0) {
      Alert.alert(
        '등록할 수 없음',
        '실제 인수증에서 인식되고 검수된 정보가 없습니다. 거짓 정보 생성을 막기 위해 등록을 중단했습니다.',
      );
      return;
    }
    const missing = fields.filter((field) => field.required && !field.value.trim());
    if (missing.length) {
      Alert.alert(
        '필수값 확인',
        `${missing.map((field) => field.label).join(', ')} 항목을 입력해주세요.`,
      );
      return;
    }
    const strictTime = valueOf('strictTime');
    const eventTime = valueOf('eventTime');
    const address = valueOf('deliveryAddress');
    const quantity = Number(valueOf('productQuantity'));
    const delivery: Delivery = {
      id: `delivery-${Date.now()}`,
      orderVendor: valueOf('orderingVendorName'),
      orderVendorTel: valueOf('orderingVendorTel'),
      deliveryVendor: valueOf('fulfillingVendorName'),
      deliveryVendorTel: valueOf('fulfillingVendorTel'),
      productName: valueOf('productName'),
      productQuantity:
        Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
      eventTime,
      deliveryDt: [valueOf('deliveryDate'), strictTime].filter(Boolean).join(' '),
      deliveryAddress: address,
      customerRequests: valueOf('memo'),
      recipientTel: valueOf('recipientTel'),
      status: 'pending',
      distanceKm: 0,
      fee: 0,
      latitude: 0,
      longitude: 0,
    };
    onRegister(delivery);
    Alert.alert('등록 완료', '검수된 OCR 정보가 오늘의 배달 목록에 추가되었습니다.');
    onClose();
  };

  const quality = result?.quality;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.scannerApp}>
        <StatusBar style="dark" />
        <View style={styles.scannerHeader}>
          <Pressable style={styles.iconButton} onPress={onClose}>
            <Ionicons name="close" size={22} color={C.text} />
          </Pressable>
          <View style={styles.scannerHeaderCopy}>
            <Text style={styles.scannerEyebrow}>SMART DOCUMENT OCR</Text>
            <Text style={styles.scannerTitle}>
              {liveOcrStageTitle(stage)}
            </Text>
          </View>
          <View style={styles.scannerStep}>
            <Text style={styles.scannerStepText}>
              {liveOcrScannerStepLabel(stage, liveSession)}
            </Text>
          </View>
        </View>

        {stage === 'capture' && (
          <ScrollView contentContainerStyle={styles.scannerContent}>
            <View style={styles.captureGuide}>
              <View style={[styles.captureCorner, styles.captureCornerTopLeft]} />
              <View style={[styles.captureCorner, styles.captureCornerTopRight]} />
              <View style={[styles.captureCorner, styles.captureCornerBottomLeft]} />
              <View style={[styles.captureCorner, styles.captureCornerBottomRight]} />
              <View style={styles.documentPreview}>
                <Ionicons name="document-text-outline" size={55} color="#89A7E8" />
                <Text style={styles.documentPreviewTitle}>3개 필드를 찾을 때까지 스캔합니다</Text>
                <Text style={styles.documentPreviewCaption}>
                  상호명, 주소, 전화번호가 모두 O로 고정되면 검토 화면으로 이동합니다.
                </Text>
              </View>
              <View style={styles.autoCaptureBadge}>
                <View style={styles.autoCaptureDot} />
                <Text style={styles.autoCaptureText}>
                  {liveSummary.frameSummary}
                </Text>
              </View>
            </View>
            <LiveScanChecklist session={liveSession} />
            <View style={styles.captureTips}>
              <View style={styles.captureTip}>
                <Ionicons name="sunny-outline" size={20} color={C.primary} />
                <Text style={styles.captureTipText}>밝은 곳</Text>
              </View>
              <View style={styles.captureTip}>
                <Ionicons name="scan-outline" size={20} color={C.primary} />
                <Text style={styles.captureTipText}>문서 전체</Text>
              </View>
              <View style={styles.captureTip}>
                <Ionicons name="phone-portrait-outline" size={20} color={C.primary} />
                <Text style={styles.captureTipText}>수직 촬영</Text>
              </View>
            </View>
            <Pressable style={styles.scanPrimaryButton} onPress={() => selectImage(true)}>
              <Ionicons name="camera" size={21} color="#FFFFFF" />
              <Text style={styles.scanPrimaryButtonText}>
                {liveSummary.primaryCaptureLabel}
              </Text>
            </Pressable>
            <Pressable style={styles.scanSecondaryButton} onPress={() => selectImage(false)}>
              <Ionicons name="images-outline" size={20} color={C.primary} />
              <Text style={styles.scanSecondaryButtonText}>갤러리 프레임 추가</Text>
            </Pressable>
          </ScrollView>
        )}

        {stage === 'quality' && quality && (
          <ScrollView contentContainerStyle={styles.scannerContent}>
            <View style={styles.qualityPreview}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.qualityImage} />
              ) : (
                <View style={styles.qualityDemoImage}>
                  <Ionicons name="receipt-outline" size={52} color={C.primary} />
                  <Text style={styles.qualityDemoText}>샘플 배송 인수증</Text>
                </View>
              )}
              <View style={styles.documentBoundary} />
              <View style={[styles.qualityScoreCircle, { borderColor: quality.passed ? C.success : C.warning }]}>
                <Text style={[styles.qualityScore, { color: quality.passed ? C.success : C.warning }]}>
                  {quality.score}
                </Text>
                <Text style={styles.qualityScoreLabel}>품질</Text>
              </View>
            </View>
            <View style={styles.qualityCard}>
              <View style={styles.qualityCardHeader}>
                <Text style={styles.qualityCardTitle}>프레임 품질 분석</Text>
                <View style={[styles.badge, quality.passed ? styles.successBadge : styles.waitBadge]}>
                  <Text style={[styles.badgeText, { color: quality.passed ? C.success : C.warning }]}>
                    {quality.passed ? 'OCR 진행 가능' : '재촬영 권장'}
                  </Text>
                </View>
              </View>
              <QualityMeter label="선명도" value={quality.blur} icon="aperture-outline" />
              <QualityMeter label="밝기" value={quality.brightness} icon="sunny-outline" />
              <QualityMeter label="문서 영역" value={quality.documentCoverage} icon="scan-outline" />
              <QualityMeter label="기울기" value={quality.skew} icon="move-outline" />
              <QualityMeter label="그림자" value={quality.shadow} icon="contrast-outline" />
            </View>
            {quality.messages.map((message) => (
              <View key={message} style={styles.qualityWarning}>
                <Ionicons name="warning-outline" size={18} color={C.warning} />
                <Text style={styles.qualityWarningText}>{message}</Text>
              </View>
            ))}
            <View style={styles.variantInfo}>
              <Ionicons name="layers-outline" size={20} color={C.primary} />
              <Text style={styles.variantInfoText}>
                품질이 통과한 프레임만 OCR에 넣고, 필드별 후보를 누적합니다.
              </Text>
            </View>
            <View style={styles.scanActionRow}>
              <Pressable style={styles.scanSecondaryFlex} onPress={reset}>
                <Text style={styles.scanSecondaryButtonText}>스캔 초기화</Text>
              </Pressable>
              <Pressable style={styles.scanPrimaryFlex} onPress={analyze}>
                <Text style={styles.scanPrimaryButtonText}>이 프레임 누적</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          </ScrollView>
        )}

        {stage === 'processing' && (
          <View style={styles.processingScreen}>
            <View style={styles.processingIcon}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
            <Text style={styles.processingTitle}>인수증을 정밀 분석하고 있습니다</Text>
            <Text style={styles.processingCaption}>
              프레임 OCR은 온디바이스로만 수행하고, 온라인 검증은 리뷰 진입 후 한 번만 실행합니다.
            </Text>
            {['프레임 품질 gate', '로컬 PP-OCR 실행', '상호명·주소·전화번호 후보 누적', '3개 필드 lock 판정'].map(
              (item, index) => (
                <View key={item} style={styles.processingStep}>
                  <View style={[styles.processingStepIcon, index < 2 && styles.processingStepIconActive]}>
                    <Ionicons
                      name={index < 2 ? 'checkmark' : 'ellipsis-horizontal'}
                      size={15}
                      color={index < 2 ? '#FFFFFF' : C.textMuted}
                    />
                  </View>
                  <Text style={styles.processingStepText}>{item}</Text>
                </View>
              ),
            )}
          </View>
        )}

        {stage === 'review' && result && (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
            <ScrollView contentContainerStyle={styles.reviewContent} keyboardShouldPersistTaps="handled">
              <View style={styles.ocrSummaryCard}>
                <View>
                  <Text style={styles.ocrSummaryLabel}>문서 전체 신뢰도</Text>
                  <Text style={styles.ocrSummaryValue}>{result.documentConfidence}%</Text>
                </View>
                <View style={styles.ocrSummaryMeta}>
                  <Text style={styles.ocrSummaryMetaText}>
                    {result.engine === 'ppocrv5'
                      ? `PP-OCRv5 온디바이스 OCR${result.modelVersion ? ` · ${result.modelVersion}` : ''}`
                      : '명시적 테스트 샘플'}
                  </Text>
                  <Text style={styles.ocrSummaryMetaText}>
                    {liveSession.acceptedFrameCount}개 프레임 누적 · {result.processingMs}ms
                  </Text>
                </View>
              </View>
              <LiveScanChecklist session={liveSession} />
              <View style={styles.reviewGuide}>
                <Ionicons name="information-circle-outline" size={19} color={C.primary} />
                <Text style={styles.reviewGuideText}>
                  노란색과 빨간색 항목을 확인하세요. 수정한 값은 다음 인식 개선 데이터로 저장할 수 있습니다.
                </Text>
              </View>
              {fields.map((field) => (
                <View
                  key={field.key}
                  style={[
                    styles.ocrFieldCard,
                    field.status === 'warning' || field.status === 'missing'
                      ? styles.ocrFieldCardWarning
                      : undefined,
                  ]}
                >
                  <View style={styles.ocrFieldHeader}>
                    <View style={styles.ocrFieldTitleGroup}>
                      <View style={styles.ocrFieldIcon}>
                        <Ionicons name={OCR_FIELD_ICONS[field.key]} size={19} color={C.primary} />
                      </View>
                      <View>
                        <Text style={styles.ocrFieldLabel}>
                          {field.label}
                          {field.required ? ' *' : ''}
                        </Text>
                        <Text style={styles.ocrFieldSource} numberOfLines={1}>
                          원문: {field.sourceText || '인식된 원문 없음'}
                        </Text>
                      </View>
                    </View>
                    <ConfidenceBadge field={field} />
                  </View>
                  <TextInput
                    value={field.value}
                    onChangeText={(value) => updateField(field.key, value)}
                    placeholder={`${field.label} 입력`}
                    placeholderTextColor="#9AA5B7"
                    multiline={field.key === 'memo' || field.key === 'deliveryAddress'}
                    style={[
                      styles.ocrFieldInput,
                      (field.key === 'memo' || field.key === 'deliveryAddress') && styles.ocrFieldInputMultiline,
                    ]}
                  />
                  {field.alternatives.length > 1 && (
                    <View style={styles.candidateRow}>
                      <Text style={styles.candidateLabel}>다른 후보</Text>
                      {field.alternatives.slice(0, 2).map((candidate) => (
                        <Pressable
                          key={candidate}
                          style={styles.candidateChip}
                          onPress={() => updateField(field.key, candidate)}
                        >
                          <Text style={styles.candidateChipText}>{candidate}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {(field.key === 'orderingVendorName' ||
                    (!valueOf('orderingVendorName') && field.key === 'venueName')) &&
                    vendorCheck && (
                    <View style={styles.vendorCheckRow}>
                      <Ionicons
                        name={
                          vendorCheck.status === 'confirmed'
                            ? 'checkmark-circle'
                            : vendorCheck.status === 'ambiguous'
                              ? 'help-circle'
                              : 'close-circle'
                        }
                        size={15}
                        color={
                          vendorCheck.status === 'confirmed'
                            ? C.success
                            : vendorCheck.status === 'ambiguous'
                              ? C.warning
                              : C.textMuted
                        }
                      />
                      <Text style={styles.vendorCheckText} numberOfLines={2}>
                        {vendorCheck.status === 'confirmed'
                          ? `온라인 확인됨: ${vendorCheck.best?.name ?? ''}${
                              vendorCheck.best?.phone
                                ? ` · ${vendorCheck.best.phone}`
                                : ''
                            }`
                          : vendorCheck.status === 'ambiguous'
                            ? `유사 업체 ${vendorCheck.candidates.length}곳 — 직접 확인 필요`
                            : '온라인에서 일치하는 업체를 찾지 못했습니다'}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
              <View style={styles.privacyNotice}>
                <Ionicons name="shield-checkmark-outline" size={20} color={C.success} />
                <Text style={styles.privacyNoticeText}>
                  사용자 수정 이력은 전화번호·주소를 익명화한 뒤 양식 개선 정보로만 저장합니다.
                </Text>
              </View>
              <Pressable style={styles.scanPrimaryButton} onPress={register}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
                <Text style={styles.scanPrimaryButtonText}>검수 완료 · 배달 목록에 등록</Text>
              </Pressable>
              <Pressable style={styles.scanSecondaryButton} onPress={reset}>
                <Text style={styles.scanSecondaryButtonText}>다른 인수증 촬영</Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

export default function RouteloApp() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const deliveries = useMemo(
    () => orders.map(orderToLegacyDelivery),
    [orders],
  );
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery>();
  const [scannerVisible, setScannerVisible] = useState(false);
  const [account, setAccount] = useState<AccountState>();
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [settings, setSettings] = useState<RouteloSettings>(
    DEFAULT_ROUTELO_SETTINGS,
  );
  const [fuelLogs] = useState<FuelLog[]>([]);

  useEffect(() => {
    deliveryRepository
      .initialize()
      .then(async () => {
        const stored = await deliveryRepository.list();
        if (stored.length) setOrders(stored);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    accountRepository
      .get()
      .then((stored) => {
        if (stored) setAccount(stored);
        else setOnboardingVisible(true);
      })
      .catch(() => setOnboardingVisible(true));
  }, []);

  useEffect(() => {
    settingsRepository
      .get()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  const notificationCount = 3;
  const openNotifications = () => setActiveTab('notifications');
  const toggleSelected = async () => {
    if (!selectedDelivery) return;
    const currentOrder = orders.find(
      (item) => item.id === selectedDelivery.id,
    );
    if (!currentOrder) return;
    const completed = currentOrder.status !== 'completed';
    const nextOrder: DeliveryOrder = {
      ...currentOrder,
      status: completed ? 'completed' : 'pending',
      schedule: {
        ...currentOrder.schedule,
        completedAt: completed ? new Date().toISOString() : undefined,
      },
      updatedAt: new Date().toISOString(),
    };
    setOrders((current) =>
      current.map((item) => (item.id === nextOrder.id ? nextOrder : item)),
    );
    await deliveryRepository.save(nextOrder);
    setSelectedDelivery((current) =>
      current
        ? {
            ...current,
            status: current.status === 'completed' ? 'pending' : 'completed',
          }
        : current,
    );
  };

  const screen = useMemo(() => {
    if (activeTab === 'deliveries') {
      return (
        <DeliveryListScreen
          deliveries={deliveries}
          onDeliveryPress={setSelectedDelivery}
          onNotifications={openNotifications}
        />
      );
    }
    if (activeTab === 'calendar') {
      return (
        <CalendarScreen
          orders={orders}
          fuelLogs={fuelLogs}
          settings={settings}
          onDeliveryPress={setSelectedDelivery}
          onNotifications={openNotifications}
        />
      );
    }
    if (activeTab === 'route') {
      return (
        <RouteScreen
          deliveries={deliveries}
          navApp={settings.route.navApp}
          allowReorder={settings.route.allowManualReorder}
          onDeliveryPress={setSelectedDelivery}
          onNotifications={openNotifications}
        />
      );
    }
    if (activeTab === 'notifications') return <NotificationsScreen />;
    if (activeTab === 'settings') {
      return (
        <SettingsScreen
          account={account}
          settings={settings}
          onSettingsChange={setSettings}
          onEditAccount={() => setOnboardingVisible(true)}
        />
      );
    }
    return (
      <HomeScreen
        deliveries={deliveries}
        onDeliveryPress={setSelectedDelivery}
        onSeeAll={() => setActiveTab('deliveries')}
        onNotifications={openNotifications}
      />
    );
  }, [account, activeTab, deliveries, fuelLogs, orders, settings]);

  const darkMode = settings.appearance.themeMode === 'dark';
  const C = darkMode ? DARK : LIGHT;
  const styles = useMemo(() => makeStyles(C), [C]);

  return (
    <ThemeContext.Provider value={{ C, styles }}>
    <PrivacyContext.Provider
      value={{
        showFullPhoneInList: settings.privacy.showFullPhoneInList,
        showFullAddressInList: settings.privacy.showFullAddressInList,
      }}
    >
    <SafeAreaView
      style={styles.app}
      edges={['top', 'left', 'right']}
    >
      <StatusBar style={darkMode ? 'light' : 'dark'} />
      <View style={styles.mainContent}>{screen}</View>
      <Pressable
        testID="open-ocr-scanner"
        style={[styles.scanFab, { bottom: 78 + insets.bottom }]}
        onPress={() => setScannerVisible(true)}
      >
        <Ionicons name="scan-outline" size={23} color="#FFFFFF" />
        <Text style={styles.scanFabText}>인수증 스캔</Text>
      </Pressable>
      <View style={styles.bottomNavBoundary}>
        <View
          style={[
            styles.bottomNav,
            {
              minHeight: 66 + insets.bottom,
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          {tabs.map((tab) => {
            const selected = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                testID={`nav-${tab.key}`}
                style={styles.navItem}
                onPress={() => setActiveTab(tab.key)}
              >
                <View style={[styles.navIcon, selected && styles.navIconSelected]}>
                  <Ionicons
                    name={selected ? tab.activeIcon : tab.icon}
                    size={22}
                    color={selected ? C.primary : C.textMuted}
                  />
                  {tab.key === 'notifications' && notificationCount > 0 && (
                    <View style={styles.navNotificationDot} />
                  )}
                </View>
                <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <DeliveryDetailSheet
        delivery={selectedDelivery}
        visible={Boolean(selectedDelivery)}
        onClose={() => setSelectedDelivery(undefined)}
        onToggle={toggleSelected}
      />
      <OcrScannerModal
        visible={scannerVisible}
        settings={settings}
        onClose={() => setScannerVisible(false)}
        onRegister={(delivery) => {
          const fee = calculateFeeByAddress(delivery.deliveryAddress, settings);
          const district = findDistrictByAddress(delivery.deliveryAddress, settings);
          const order = legacyDeliveryToOrder({
            ...delivery,
            fee,
          });
          order.settlement.district = district;
          order.source = { type: 'ocr' };
          setOrders((current) => [order, ...current]);
          deliveryRepository.save(order).catch(() => undefined);
          setActiveTab('deliveries');
        }}
      />
      <OnboardingModal
        visible={onboardingVisible}
        initial={account}
        onComplete={(state) => {
          setAccount(state);
          setOnboardingVisible(false);
          accountRepository.save(state).catch(() => undefined);
        }}
      />
    </SafeAreaView>
    </PrivacyContext.Provider>
    </ThemeContext.Provider>
  );
}

const makeStyles = (C: Palette) =>
  StyleSheet.create({
  app: { flex: 1, backgroundColor: C.background },
  onboardingApp: { flex: 1, backgroundColor: C.background },
  onboardingContent: { padding: 22, paddingBottom: 40 },
  onboardingBrand: { alignItems: 'center', paddingVertical: 28 },
  onboardingLogo: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  onboardingTitle: { color: C.navy, fontSize: 27, fontWeight: '900' },
  onboardingSubtitle: {
    color: C.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 21,
  },
  onboardingChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.outline,
    padding: 18,
    minHeight: 96,
    marginBottom: 12,
  },
  onboardingChoiceTitle: { color: C.navy, fontSize: 17, fontWeight: '800' },
  onboardingChoiceText: {
    color: C.textMuted,
    lineHeight: 19,
    marginTop: 4,
  },
  onboardingForm: {
    backgroundColor: C.surface,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: C.outline,
  },
  onboardingSectionTitle: {
    color: C.navy,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 9,
  },
  onboardingInput: {
    minHeight: 52,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.outline,
    backgroundColor: C.background,
    paddingHorizontal: 14,
    color: C.text,
    marginBottom: 10,
  },
  energyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  energyChip: {
    paddingHorizontal: 12,
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: C.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  energyChipActive: {
    backgroundColor: C.primaryContainer,
    borderColor: C.primary,
  },
  energyChipText: { color: C.textMuted, fontSize: 12, fontWeight: '700' },
  energyChipTextActive: { color: C.primary },
  onboardingPrivacy: {
    color: C.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginVertical: 10,
  },
  mainContent: { flex: 1 },
  flex: { flex: 1 },
  screenContent: { paddingHorizontal: 18, paddingBottom: 28 },
  calendarModeRow: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 18,
    backgroundColor: C.surfaceAlt,
    marginBottom: 12,
  },
  calendarModeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarModeButtonActive: {
    backgroundColor: C.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  calendarModeText: { color: C.textMuted, fontWeight: '700' },
  calendarModeTextActive: { color: C.primary },
  calendarCard: {
    backgroundColor: C.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.outline,
    padding: 14,
    marginBottom: 22,
  },
  calendarToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  calendarTitle: { fontSize: 18, color: C.navy, fontWeight: '800' },
  calendarWeekHeader: { flexDirection: 'row', marginBottom: 5 },
  calendarWeekLabel: {
    width: '14.2857%',
    textAlign: 'center',
    color: C.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarDay: {
    width: '14.2857%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    gap: 2,
  },
  calendarDayWide: { minHeight: 64 },
  calendarDaySelected: { backgroundColor: C.primaryContainer },
  calendarDayText: { color: C.text, fontWeight: '700' },
  calendarDayOutside: { color: '#B7C0CE' },
  calendarDayTextSelected: { color: C.onPrimaryContainer },
  calendarCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCountUrgent: { backgroundColor: C.danger },
  calendarCountText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  calendarMoneyStack: {
    width: '100%',
    paddingHorizontal: 2,
    alignItems: 'center',
    gap: 1,
  },
  calendarNetText: {
    color: C.success,
    fontSize: 10,
    fontWeight: '900',
  },
  calendarNetTextNegative: { color: C.danger },
  calendarNetTextUrgent: { color: C.warning },
  calendarFuelText: {
    color: C.textMuted,
    fontSize: 8,
    fontWeight: '700',
  },
  profitSummaryCard: {
    backgroundColor: C.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.outline,
    padding: 18,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
  },
  profitSummaryLabel: { color: C.textMuted, fontSize: 12, fontWeight: '700' },
  profitSummaryValue: {
    color: C.success,
    fontSize: 24,
    fontWeight: '900',
    marginTop: 4,
  },
  profitSummaryValueNegative: { color: C.danger },
  profitSummaryMeta: { justifyContent: 'center', alignItems: 'flex-end', gap: 4 },
  profitSummaryMetaText: { color: C.textMuted, fontSize: 11, fontWeight: '700' },
  calendarEmpty: {
    backgroundColor: C.surface,
    borderRadius: 22,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.outline,
  },
  calendarEmptyTitle: {
    marginTop: 10,
    fontSize: 16,
    color: C.navy,
    fontWeight: '800',
  },
  calendarEmptyText: {
    marginTop: 5,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  calendarAgendaCard: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.outline,
    padding: 16,
    marginBottom: 10,
  },
  calendarAgendaCardConflict: {
    borderColor: C.warning,
    backgroundColor: C.warningBg,
  },
  calendarAgendaCardLate: {
    borderColor: C.danger,
  },
  calendarTimeColumn: { width: 86, paddingRight: 12 },
  calendarAgendaTime: { fontSize: 16, color: C.primary, fontWeight: '900' },
  calendarPrecision: {
    marginTop: 4,
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  calendarAgendaBody: { flex: 1 },
  calendarAgendaTitle: { color: C.navy, fontSize: 16, fontWeight: '800' },
  calendarAgendaAddress: {
    marginTop: 5,
    color: C.textMuted,
    lineHeight: 19,
  },
  calendarMetaRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  calendarUrgentText: { color: C.danger, fontSize: 12, fontWeight: '800' },
  calendarEventText: { color: C.warning, fontSize: 12, fontWeight: '800' },
  calendarConflictText: { color: C.warning, fontSize: 12, fontWeight: '900' },
  calendarLateText: { color: C.danger, fontSize: 12, fontWeight: '900' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? 18 : 8,
    paddingBottom: 18,
  },
  headerCopy: { flex: 1, paddingRight: 12 },
  eyebrow: {
    color: C.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 5,
  },
  screenTitle: { color: C.text, fontSize: 27, fontWeight: '800', letterSpacing: -0.7 },
  screenSubtitle: { color: C.textMuted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  headerAction: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationCounter: {
    position: 'absolute',
    right: -3,
    top: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: C.danger,
    borderWidth: 2,
    borderColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationCounterText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  sectionHeader: {
    marginTop: 24,
    marginBottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  sectionCaption: { color: C.textMuted, fontSize: 11, marginTop: 3 },
  metricsGrid: { flexDirection: 'row', gap: 9 },
  metricCard: {
    flex: 1,
    minHeight: 122,
    padding: 14,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.outline,
  },
  metricIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
  },
  metricValue: { color: C.text, fontSize: 22, fontWeight: '800' },
  metricLabel: { color: C.textMuted, fontSize: 10, fontWeight: '600', marginTop: 3 },
  progressCard: {
    marginTop: 11,
    padding: 18,
    borderRadius: 22,
    backgroundColor: C.emphasis,
  },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { color: '#BFCBE0', fontSize: 11, fontWeight: '600' },
  progressValue: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', marginTop: 3 },
  progressSummary: { alignItems: 'flex-end' },
  progressSummaryValue: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  progressSummaryLabel: { color: '#9EADC7', fontSize: 9, marginTop: 2 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#35445F',
    marginTop: 15,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: '#7FA7FF' },
  progressMeta: { flexDirection: 'row', gap: 18, marginTop: 13 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { color: C.textMuted, fontSize: 10, fontWeight: '600' },
  timeAlert: {
    minHeight: 92,
    borderRadius: 20,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 9,
    borderWidth: 1,
  },
  deadlineAlert: { backgroundColor: C.warningBg, borderColor: C.warning },
  eventAlert: { backgroundColor: C.dangerBg, borderColor: C.danger },
  timeIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  timeAlertLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  timeAlertTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 },
  timeAlertTime: { color: C.text, fontSize: 20, fontWeight: '900' },
  timeAlertTitle: { flex: 1, color: C.text, fontSize: 13, fontWeight: '700' },
  timeAlertAddress: { color: C.textMuted, fontSize: 10, marginTop: 4 },
  textButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 5 },
  textButtonLabel: { color: C.primary, fontSize: 11, fontWeight: '800' },
  surfaceCard: {
    borderRadius: 22,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.outline,
    overflow: 'hidden',
  },
  compactDelivery: { minHeight: 104, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sequenceMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sequenceMarkerText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  compactTime: { color: C.primary, fontSize: 11, fontWeight: '800' },
  compactTitle: { color: C.text, fontSize: 14, fontWeight: '800', marginTop: 5 },
  compactAddress: { color: C.textMuted, fontSize: 10, marginTop: 4 },
  inlineUrgent: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  inlineUrgentText: { color: C.danger, fontSize: 10, fontWeight: '800' },
  divider: { height: 1, backgroundColor: C.outline, marginLeft: 14 },
  badge: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  successBadge: { backgroundColor: C.successBg },
  waitBadge: { backgroundColor: C.primaryContainer },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 9, fontWeight: '800' },
  filterSegment: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 16,
    backgroundColor: C.surfaceAlt,
    marginBottom: 14,
  },
  filterItem: { flex: 1, minHeight: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  filterItemSelected: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.outline },
  filterText: { color: C.textMuted, fontSize: 11, fontWeight: '700' },
  filterTextSelected: { color: C.primary, fontWeight: '800' },
  deliveryList: { gap: 11 },
  deliveryCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.outline,
  },
  deliveryCardTitleGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11, paddingRight: 8 },
  destinationIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  destinationIconUrgent: { backgroundColor: C.dangerBg },
  destinationName: { color: C.text, fontSize: 15, fontWeight: '800' },
  destinationVendor: { color: C.textMuted, fontSize: 10, marginTop: 3 },
  deliveryAddress: { color: C.textMuted, fontSize: 11, marginTop: 13, lineHeight: 17 },
  deliveryTimeGrid: { flexDirection: 'row', gap: 7, marginTop: 14 },
  deliveryTimeCell: { flex: 1, minHeight: 60, padding: 9, borderRadius: 14, backgroundColor: C.surfaceAlt },
  deliveryTimeCellLabel: { color: C.textMuted, fontSize: 8, fontWeight: '700' },
  deliveryTimeCellValue: { color: C.text, fontSize: 13, fontWeight: '800', marginTop: 7 },
  warningText: { color: C.warning },
  dangerText: { color: C.danger },
  deliveryCardFooter: { marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.outline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  outlinedButton: { minHeight: 40, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: '#AFC2EB', flexDirection: 'row', alignItems: 'center', gap: 4 },
  outlinedButtonText: { color: C.primary, fontSize: 10, fontWeight: '800' },
  mapCard: { height: 315, borderRadius: 24, backgroundColor: '#E8EDF0', borderWidth: 1, borderColor: C.outline, overflow: 'hidden' },
  mapRoad: { position: 'absolute', backgroundColor: '#FFFFFF', borderColor: '#D7DEE4', borderWidth: 1, borderRadius: 20 },
  mapRoadOne: { width: '120%', height: 25, left: '-10%', top: '52%', transform: [{ rotate: '-16deg' }] },
  mapRoadTwo: { width: 24, height: '120%', left: '54%', top: '-10%', transform: [{ rotate: '18deg' }] },
  mapRoadThree: { width: '70%', height: 15, left: '15%', top: '26%', transform: [{ rotate: '8deg' }] },
  mapPark: { position: 'absolute', width: 130, height: 90, borderRadius: 50, backgroundColor: '#D8E7D7', left: -30, bottom: 10 },
  routeLineVisual: { position: 'absolute', height: 5, borderRadius: 3, backgroundColor: C.primary },
  routeArrow: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: C.primary, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  currentLocation: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: '#BBD0FF', alignItems: 'center', justifyContent: 'center' },
  currentLocationInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary, borderWidth: 2, borderColor: '#FFFFFF' },
  mapPin: { position: 'absolute', width: 36, height: 36, borderRadius: 18, backgroundColor: C.primary, borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  mapPinText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  mapLegend: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  googleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  mapLegendText: { color: C.text, fontSize: 9, fontWeight: '700' },
  nextDestinationCard: { marginTop: 11, padding: 17, borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.outline },
  nextDestinationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: C.primaryContainer },
  nextBadgeText: { color: C.primary, fontSize: 9, fontWeight: '800' },
  nextEta: { color: C.textMuted, fontSize: 10, fontWeight: '600' },
  nextTitle: { color: C.text, fontSize: 19, fontWeight: '800', marginTop: 14 },
  nextAddress: { color: C.textMuted, fontSize: 11, marginTop: 5 },
  nextInfoRow: { flexDirection: 'row', marginTop: 17, paddingVertical: 13, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.outline },
  nextInfo: { flex: 1 },
  nextInfoLabel: { color: C.textMuted, fontSize: 8, fontWeight: '700' },
  nextInfoValue: { color: C.text, fontSize: 14, fontWeight: '800', marginTop: 5 },
  nextInfoDivider: { width: 1, backgroundColor: C.outline, marginHorizontal: 10 },
  priorityNotice: { marginTop: 13, padding: 11, borderRadius: 13, backgroundColor: C.dangerBg, flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityNoticeText: { flex: 1, color: C.danger, fontSize: 10, fontWeight: '700', lineHeight: 15 },
  routeButtons: { flexDirection: 'row', gap: 9, marginTop: 14 },
  routeStackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, gap: 12 },
  routeStackOrder: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  routeStackOrderText: { color: C.primary, fontSize: 12, fontWeight: '800' },
  routeStackBody: { flex: 1 },
  routeStackTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  routeStackAddress: { color: C.textMuted, fontSize: 11, marginTop: 2 },
  routeStackControls: { flexDirection: 'row', gap: 4 },
  routeStackArrow: { width: 34, height: 34, borderRadius: 11, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  navAppOptions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  navAppOption: { flex: 1, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: C.outline, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  navAppOptionActive: { borderColor: C.primary, backgroundColor: C.primaryContainer },
  navAppOptionText: { color: C.textMuted, fontSize: 13, fontWeight: '700' },
  navAppOptionTextActive: { color: C.primary, fontWeight: '800' },
  primaryButton: { flex: 1, minHeight: 48, borderRadius: 15, backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  secondaryButton: { flex: 1, minHeight: 48, borderRadius: 15, backgroundColor: C.primaryContainer, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  secondaryButtonText: { color: C.primary, fontSize: 11, fontWeight: '800' },
  notificationSummary: { minHeight: 95, borderRadius: 22, padding: 17, backgroundColor: C.emphasis, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notificationSummaryLabel: { color: '#BFCBE0', fontSize: 10 },
  notificationSummaryValue: { color: '#FFFFFF', fontSize: 25, fontWeight: '800', marginTop: 5 },
  urgencyLegend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4, marginLeft: 6 },
  legendText: { color: '#D2DBEB', fontSize: 9 },
  notificationList: { gap: 9 },
  notificationCard: { minHeight: 116, padding: 15, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.outline, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  notificationIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  notificationUrgency: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  notificationTime: { color: C.textMuted, fontSize: 9 },
  notificationTitle: { color: C.text, fontSize: 14, fontWeight: '800', marginTop: 7 },
  notificationBody: { color: C.textMuted, fontSize: 10, lineHeight: 16, marginTop: 5 },
  profileCard: { minHeight: 88, padding: 15, borderRadius: 22, backgroundColor: C.emphasis, flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileAvatar: { width: 50, height: 50, borderRadius: 17, backgroundColor: '#E5ECFF', alignItems: 'center', justifyContent: 'center' },
  profileName: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  profileCaption: { color: '#AEBBD1', fontSize: 10, marginTop: 4 },
  iconButton: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  settingsGroup: { borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.outline, overflow: 'hidden' },
  districtFeePanel: {
    backgroundColor: C.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.outline,
    padding: 14,
    marginBottom: 16,
  },
  districtSearchInput: {
    minHeight: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.outline,
    backgroundColor: C.background,
    color: C.text,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  districtFeeGroupTitle: {
    color: C.navy,
    fontSize: 15,
    fontWeight: '900',
  },
  districtFeeGroupSpacing: { marginTop: 16 },
  districtRegion: { borderTopWidth: 1, borderTopColor: C.outline },
  districtRegionHeader: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  districtRegionRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  districtRegionCount: { color: C.textMuted, fontSize: 11, fontWeight: '700' },
  districtEmptyText: { color: C.textMuted, fontSize: 11, paddingVertical: 10 },
  districtFeeRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: C.outline,
    paddingVertical: 7,
  },
  districtFeeName: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
  },
  districtFeeInput: {
    width: 104,
    minHeight: 40,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.outline,
    backgroundColor: C.background,
    paddingHorizontal: 10,
    color: C.text,
    textAlign: 'right',
    fontWeight: '800',
  },
  districtFeeUnit: { width: 18, color: C.textMuted, fontSize: 12, fontWeight: '700' },
  settingRow: { minHeight: 76, paddingHorizontal: 15, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  settingTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
  settingCaption: { color: C.textMuted, fontSize: 9, marginTop: 4 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.48)' },
  bottomSheet: { paddingHorizontal: 20, paddingBottom: 28, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: C.surface },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: C.outline, alignSelf: 'center', marginTop: 10, marginBottom: 18 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  sheetEyebrow: { color: C.primary, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  sheetTitle: { color: C.text, fontSize: 21, fontWeight: '800', marginTop: 4 },
  sheetAddress: { flexDirection: 'row', gap: 8, marginTop: 17, padding: 13, borderRadius: 15, backgroundColor: C.surfaceAlt },
  sheetAddressText: { flex: 1, color: C.text, fontSize: 12, lineHeight: 18 },
  sheetTimeGrid: { flexDirection: 'row', gap: 8, marginTop: 12 },
  sheetTimeItem: { flex: 1, minHeight: 70, padding: 10, borderRadius: 14, backgroundColor: C.surfaceAlt },
  sheetTimeLabel: { color: C.textMuted, fontSize: 8, fontWeight: '700' },
  sheetTimeValue: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 8 },
  sheetInfoBlock: { marginTop: 12, padding: 13, borderRadius: 15, backgroundColor: C.surfaceAlt },
  sheetInfoLabel: { color: C.textMuted, fontSize: 9, fontWeight: '700' },
  sheetInfoText: { color: C.text, fontSize: 11, lineHeight: 17, marginTop: 5 },
  sheetActions: { flexDirection: 'row', gap: 9, marginTop: 16 },
  scanFab: {
    position: 'absolute',
    right: 18,
    bottom: Platform.OS === 'ios' ? 90 : 82,
    minHeight: 54,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: C.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#102A65',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 12,
    zIndex: 20,
  },
  scanFabText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  scannerApp: { flex: 1, backgroundColor: C.background },
  scannerHeader: {
    minHeight: 78,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.outline,
    backgroundColor: C.surface,
  },
  scannerHeaderCopy: { flex: 1, marginHorizontal: 12 },
  scannerEyebrow: { color: C.primary, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  scannerTitle: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 3 },
  scannerStep: {
    minWidth: 40,
    height: 30,
    paddingHorizontal: 9,
    borderRadius: 15,
    backgroundColor: C.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerStepText: { color: C.primary, fontSize: 10, fontWeight: '800' },
  scannerContent: { padding: 18, paddingBottom: 36 },
  captureGuide: {
    height: 390,
    borderRadius: 26,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.outline,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  captureCorner: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderColor: C.primary,
  },
  captureCornerTopLeft: { left: 24, top: 24, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 12 },
  captureCornerTopRight: { right: 24, top: 24, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 12 },
  captureCornerBottomLeft: { left: 24, bottom: 24, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 12 },
  captureCornerBottomRight: { right: 24, bottom: 24, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 12 },
  documentPreview: { width: '75%', alignItems: 'center' },
  documentPreviewTitle: { color: C.text, fontSize: 15, fontWeight: '800', textAlign: 'center', marginTop: 16 },
  documentPreviewCaption: { color: C.textMuted, fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 7 },
  autoCaptureBadge: {
    position: 'absolute',
    bottom: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  autoCaptureDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.success },
  autoCaptureText: { color: C.textMuted, fontSize: 9, fontWeight: '700' },
  liveChecklist: {
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.outline,
    padding: 14,
    marginTop: 12,
    gap: 9,
  },
  liveChecklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  liveChecklistTitle: { color: C.text, fontSize: 14, fontWeight: '900' },
  liveChecklistMeta: { color: C.primary, fontSize: 12, fontWeight: '900' },
  liveChecklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.outline,
    paddingHorizontal: 12,
  },
  liveChecklistItemCandidate: {
    borderColor: C.warning,
    backgroundColor: C.warningBg,
  },
  liveChecklistItemLocked: {
    borderColor: C.success,
    backgroundColor: C.successBg,
    transform: [{ scale: 1.01 }],
  },
  liveChecklistIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveChecklistLabel: { color: C.text, fontSize: 12, fontWeight: '900' },
  liveChecklistValue: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  captureTips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  captureTip: {
    flex: 1,
    minHeight: 62,
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.outline,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  captureTipText: { color: C.textMuted, fontSize: 9, fontWeight: '700' },
  scanPrimaryButton: {
    minHeight: 54,
    borderRadius: 17,
    backgroundColor: C.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 15,
  },
  scanPrimaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  scanSecondaryButton: {
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: '#AFC2EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 9,
  },
  scanSecondaryButtonText: { color: C.primary, fontSize: 11, fontWeight: '800' },
  qualityPreview: {
    height: 285,
    borderRadius: 24,
    backgroundColor: C.surfaceAlt,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  qualityDemoImage: { alignItems: 'center', justifyContent: 'center' },
  qualityDemoText: { color: C.textMuted, fontSize: 11, fontWeight: '700', marginTop: 10 },
  documentBoundary: {
    position: 'absolute',
    left: 34,
    right: 34,
    top: 22,
    bottom: 22,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#73A0FF',
  },
  qualityScoreCircle: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityScore: { fontSize: 18, fontWeight: '900' },
  qualityScoreLabel: { color: C.textMuted, fontSize: 7, fontWeight: '700' },
  qualityCard: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.outline,
    marginTop: 12,
  },
  qualityCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  qualityCardTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  qualityRow: { minHeight: 37, flexDirection: 'row', alignItems: 'center', gap: 9 },
  qualityLabelGroup: { width: 78, flexDirection: 'row', alignItems: 'center', gap: 6 },
  qualityLabel: { color: C.textMuted, fontSize: 9, fontWeight: '700' },
  qualityTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: C.surfaceAlt, overflow: 'hidden' },
  qualityFill: { height: '100%', borderRadius: 4 },
  qualityValue: { width: 25, textAlign: 'right', fontSize: 9, fontWeight: '800' },
  qualityWarning: {
    padding: 12,
    marginTop: 9,
    borderRadius: 14,
    backgroundColor: C.warningBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qualityWarningText: { flex: 1, color: C.warning, fontSize: 10, fontWeight: '700' },
  variantInfo: {
    padding: 13,
    marginTop: 10,
    borderRadius: 15,
    backgroundColor: C.primaryContainer,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  variantInfoText: { flex: 1, color: C.onPrimaryContainer, fontSize: 10, lineHeight: 15, fontWeight: '600' },
  scanActionRow: { flexDirection: 'row', gap: 9, marginTop: 14 },
  scanSecondaryFlex: {
    flex: 0.8,
    minHeight: 52,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#AFC2EB',
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanPrimaryFlex: {
    flex: 1.2,
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: C.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  processingScreen: { flex: 1, paddingHorizontal: 35, alignItems: 'center', justifyContent: 'center' },
  processingIcon: {
    width: 92,
    height: 92,
    borderRadius: 30,
    backgroundColor: C.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingTitle: { color: C.text, fontSize: 19, fontWeight: '800', textAlign: 'center', marginTop: 24 },
  processingCaption: { color: C.textMuted, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 8, marginBottom: 25 },
  processingStep: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 11 },
  processingStepIcon: { width: 28, height: 28, borderRadius: 10, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  processingStepIconActive: { backgroundColor: C.success },
  processingStepText: { color: C.text, fontSize: 11, fontWeight: '700' },
  reviewContent: { padding: 18, paddingBottom: 38 },
  ocrSummaryCard: {
    minHeight: 105,
    padding: 17,
    borderRadius: 22,
    backgroundColor: C.emphasis,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ocrSummaryLabel: { color: '#BFCBE0', fontSize: 10, fontWeight: '600' },
  ocrSummaryValue: { color: '#FFFFFF', fontSize: 29, fontWeight: '900', marginTop: 5 },
  ocrSummaryMeta: { alignItems: 'flex-end', gap: 5 },
  ocrSummaryMetaText: { color: '#C7D3E8', fontSize: 9 },
  reviewGuide: {
    marginTop: 10,
    padding: 12,
    borderRadius: 15,
    backgroundColor: C.primaryContainer,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  reviewGuideText: { flex: 1, color: C.onPrimaryContainer, fontSize: 10, lineHeight: 16 },
  ocrFieldCard: {
    marginTop: 10,
    padding: 14,
    borderRadius: 19,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.outline,
  },
  ocrFieldCardWarning: { borderColor: C.danger, backgroundColor: C.dangerBg },
  ocrFieldHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ocrFieldTitleGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  ocrFieldIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  ocrFieldLabel: { color: C.text, fontSize: 11, fontWeight: '800' },
  ocrFieldSource: { maxWidth: 205, color: C.textMuted, fontSize: 8, marginTop: 3 },
  confidenceBadge: { height: 27, paddingHorizontal: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  confidenceText: { fontSize: 9, fontWeight: '900' },
  ocrFieldInput: {
    minHeight: 45,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.outline,
    backgroundColor: C.background,
    color: C.text,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 12,
    marginTop: 11,
  },
  ocrFieldInputMultiline: { minHeight: 70, paddingTop: 11, textAlignVertical: 'top' },
  candidateRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  candidateLabel: { color: C.textMuted, fontSize: 8, fontWeight: '700' },
  candidateChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, backgroundColor: C.surfaceAlt },
  candidateChipText: { color: C.primary, fontSize: 8, fontWeight: '700' },
  vendorCheckRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 },
  vendorCheckText: { flex: 1, color: C.textMuted, fontSize: 9, fontWeight: '700' },
  privacyNotice: {
    marginTop: 12,
    padding: 13,
    borderRadius: 15,
    backgroundColor: C.successBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  privacyNoticeText: { flex: 1, color: C.success, fontSize: 9, lineHeight: 14, fontWeight: '600' },
  bottomNavBoundary: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: '#CFD7E3',
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.09,
    shadowRadius: 12,
    elevation: 14,
    paddingTop: 6,
  },
  bottomNav: { minHeight: 70, flexDirection: 'row', paddingBottom: 8 },
  navItem: { flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center' },
  navIcon: { width: 50, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  navIconSelected: { backgroundColor: C.primaryContainer },
  navLabel: { color: C.textMuted, fontSize: 9, fontWeight: '600', marginTop: 3 },
  navLabelSelected: { color: C.primary, fontWeight: '800' },
  navNotificationDot: { position: 'absolute', right: 9, top: 5, width: 7, height: 7, borderRadius: 4, backgroundColor: C.danger, borderWidth: 1, borderColor: C.surface },
  });

const styles = makeStyles(LIGHT);
