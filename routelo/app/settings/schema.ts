export const SETTINGS_SCHEMA_VERSION = 2;

export type BusinessRuleSettings = {
  defaultDepartureAddress?: string;
  targetArrivalMinutesBeforeEvent: number;
  defaultInstallationMinutes: number;
  completionRequiresPhoto: boolean;
  completionRequiresTimestamp: boolean;
};

export type RegionalDistrictFees = {
  Seoul: Record<string, number>;
  Gyeonggi: Record<string, number>;
  Incheon: Record<string, number>;
  custom: Record<string, number>;
};

export type FeeSettingsV2 = {
  currency: 'KRW';
  defaultFee: number;
  districtFees: RegionalDistrictFees;
  feeCalculationMode: 'district' | 'manual' | 'hybrid';
};

export type RevenueCostSettings = {
  vehicleModel: string;
  fuelEfficiency: number;
  fuelTankCapacity: number;
  fuelType: 'gasoline' | 'diesel' | 'lpg' | 'hybrid' | 'electric' | 'other';
  profitBasis: 'daily' | 'monthly';
};

export type PrivacySettings = {
  preserveOriginalReceiptImage: boolean;
  preserveOcrRawText: boolean;
  preserveCompletionPhotos: boolean;
  preserveCorrectionHistory: boolean;
  retentionPeriod: '3m' | '6m' | '1y' | '3y' | 'forever';
  showFullAddressInList: boolean;
  showFullPhoneInList: boolean;
  showSensitiveInfoInNotifications: boolean;
  hideContentInAppSwitcher: boolean;
};

export type SecuritySettings = {
  appLockEnabled: boolean;
  biometricUnlockEnabled: boolean;
  encryptLocalSensitiveData: boolean;
  encryptBackupFiles: boolean;
  requireConfirmBeforeExportWithPersonalData: boolean;
};

export type OcrSettings = {
  requireReviewBelowConfidence: number;
  allowAliasLearning: boolean;
  preserveUnmappedLines: boolean;
  blockAutoRegistrationWhenRequiredFieldsMissing: boolean;
  // 발주처 업체명을 온라인 장소검색으로 교차검증(옵트인, 기본 OFF). #48/#51
  onlineVendorVerification: boolean;
};

export type NotificationSettings = {
  strictDeadlineEnabled: boolean;
  eventTimeEnabled: boolean;
  delayRiskEnabled: boolean;
  completionMissingEnabled: boolean;
  strictDeadlineLeadMinutes: number[];
  eventLeadMinutes: number[];
};

export type AppearanceSettings = {
  themeMode: 'light' | 'dark' | 'system';
  listDensity: 'comfortable' | 'compact';
};

export type NavApp = 'google' | 'tmap' | 'naver';

export type RoutePreferenceSettings = {
  routeMode: 'deadline-first' | 'distance-first' | 'profit-first' | 'manual';
  navApp: NavApp;
  allowManualReorder: boolean;
};

export type AccountSettings = {
  mode: 'guest' | 'member';
  backupEnabled: boolean;
  syncEnabled: boolean;
};

export type RouteloSettings = {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  business: BusinessRuleSettings;
  fees: FeeSettingsV2;
  costs: RevenueCostSettings;
  privacy: PrivacySettings;
  security: SecuritySettings;
  ocr: OcrSettings;
  notifications: NotificationSettings;
  appearance: AppearanceSettings;
  route: RoutePreferenceSettings;
  account: AccountSettings;
};

export type LegacyFeeSettings = {
  districtFees?: Record<string, number>;
  fuelEfficiency?: number;
  themeMode?: 'light' | 'dark';
  vehicleModel?: string;
  fuelTankCapacity?: number;
};
