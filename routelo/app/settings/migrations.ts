import {
  GYEONGGI_DISTRICTS,
  SEOUL_DISTRICTS,
} from './districts';
import { DEFAULT_ROUTELO_SETTINGS } from './defaults';
import {
  LegacyFeeSettings,
  NavApp,
  RouteloSettings,
  SETTINGS_SCHEMA_VERSION,
} from './schema';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const cloneDefaults = (): RouteloSettings =>
  JSON.parse(JSON.stringify(DEFAULT_ROUTELO_SETTINGS)) as RouteloSettings;

const normalizeNavApp = (value: unknown): NavApp =>
  value === 'google' || value === 'tmap' || value === 'naver'
    ? value
    : DEFAULT_ROUTELO_SETTINGS.route.navApp;

const mergeRecord = <T extends Record<string, unknown>>(
  defaults: T,
  stored: unknown,
): T => ({
  ...defaults,
  ...(isRecord(stored) ? stored : {}),
});

export function mergeSettingsV2(stored?: unknown): RouteloSettings {
  if (!isRecord(stored)) return cloneDefaults();
  const fees = isRecord(stored.fees) ? stored.fees : {};
  const districtFees = isRecord(fees.districtFees) ? fees.districtFees : {};
  return {
    ...DEFAULT_ROUTELO_SETTINGS,
    ...stored,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    business: mergeRecord(DEFAULT_ROUTELO_SETTINGS.business, stored.business),
    fees: {
      ...mergeRecord(DEFAULT_ROUTELO_SETTINGS.fees, fees),
      defaultFee: finiteNumber(
        fees.defaultFee,
        DEFAULT_ROUTELO_SETTINGS.fees.defaultFee,
      ),
      districtFees: {
        Seoul: mergeRecord(
          DEFAULT_ROUTELO_SETTINGS.fees.districtFees.Seoul,
          districtFees.Seoul,
        ),
        Gyeonggi: mergeRecord(
          DEFAULT_ROUTELO_SETTINGS.fees.districtFees.Gyeonggi,
          districtFees.Gyeonggi,
        ),
        Incheon: mergeRecord(
          DEFAULT_ROUTELO_SETTINGS.fees.districtFees.Incheon,
          districtFees.Incheon,
        ),
        custom: mergeRecord(
          DEFAULT_ROUTELO_SETTINGS.fees.districtFees.custom,
          districtFees.custom,
        ),
      },
    },
    costs: mergeRecord(DEFAULT_ROUTELO_SETTINGS.costs, stored.costs),
    privacy: mergeRecord(DEFAULT_ROUTELO_SETTINGS.privacy, stored.privacy),
    security: mergeRecord(DEFAULT_ROUTELO_SETTINGS.security, stored.security),
    ocr: mergeRecord(DEFAULT_ROUTELO_SETTINGS.ocr, stored.ocr),
    notifications: mergeRecord(
      DEFAULT_ROUTELO_SETTINGS.notifications,
      stored.notifications,
    ),
    appearance: mergeRecord(
      DEFAULT_ROUTELO_SETTINGS.appearance,
      stored.appearance,
    ),
    route: {
      ...mergeRecord(DEFAULT_ROUTELO_SETTINGS.route, stored.route),
      navApp: normalizeNavApp(
        isRecord(stored.route) ? stored.route.navApp : undefined,
      ),
    },
    account: mergeRecord(DEFAULT_ROUTELO_SETTINGS.account, stored.account),
  } as RouteloSettings;
}

export function migrateLegacySettings(
  legacy?: LegacyFeeSettings | null,
): RouteloSettings {
  const settings = cloneDefaults();
  if (!legacy) return settings;

  SEOUL_DISTRICTS.forEach((district) => {
    settings.fees.districtFees.Seoul[district] = finiteNumber(
      legacy.districtFees?.[district],
      settings.fees.districtFees.Seoul[district],
    );
  });
  GYEONGGI_DISTRICTS.forEach((district) => {
    settings.fees.districtFees.Gyeonggi[district] = finiteNumber(
      legacy.districtFees?.[district],
      settings.fees.districtFees.Gyeonggi[district],
    );
  });
  settings.costs.vehicleModel =
    legacy.vehicleModel || settings.costs.vehicleModel;
  settings.costs.fuelEfficiency = finiteNumber(
    legacy.fuelEfficiency,
    settings.costs.fuelEfficiency,
  );
  settings.costs.fuelTankCapacity = finiteNumber(
    legacy.fuelTankCapacity,
    settings.costs.fuelTankCapacity,
  );
  settings.appearance.themeMode =
    legacy.themeMode || settings.appearance.themeMode;
  return settings;
}
