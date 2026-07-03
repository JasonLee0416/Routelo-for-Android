import { KeyValueStore } from '../../repositories';
import { DEFAULT_ROUTELO_SETTINGS } from '../defaults';
import { migrateLegacySettings, mergeSettingsV2 } from '../migrations';
import {
  SettingsRepository,
  SETTINGS_V1_KEY,
  SETTINGS_V2_KEY,
} from '../repository';

class MemoryStore implements KeyValueStore {
  values = new Map<string, string>();

  async getItem(key: string) {
    return this.values.get(key) || null;
  }

  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  async removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('settings v2 migration', () => {
  it('preserves legacy district, theme, and vehicle values', () => {
    const migrated = migrateLegacySettings({
      districtFees: { 강남구: 18000, 성남시: 22000 },
      themeMode: 'dark',
      vehicleModel: '기아 봉고3',
      fuelEfficiency: 10.2,
      fuelTankCapacity: 58,
    });

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.fees.districtFees.Seoul.강남구).toBe(18000);
    expect(migrated.fees.districtFees.Gyeonggi.성남시).toBe(22000);
    expect(migrated.appearance.themeMode).toBe('dark');
    expect(migrated.costs).toMatchObject({
      vehicleModel: '기아 봉고3',
      fuelEfficiency: 10.2,
      fuelTankCapacity: 58,
    });
  });

  it('fills partial v2 settings with conservative defaults', () => {
    const merged = mergeSettingsV2({
      schemaVersion: 2,
      fees: { defaultFee: 17000 },
      privacy: { showFullPhoneInList: true },
    });

    expect(merged.fees.defaultFee).toBe(17000);
    expect(merged.fees.districtFees.Seoul.강남구).toBe(15000);
    expect(merged.privacy.showFullPhoneInList).toBe(true);
    expect(merged.privacy.preserveOriginalReceiptImage).toBe(true);
    expect(merged.ocr.blockAutoRegistrationWhenRequiredFieldsMissing).toBe(
      true,
    );
  });

  it('normalizes legacy Kakao navigation settings to Google Maps', () => {
    const merged = mergeSettingsV2({
      schemaVersion: 2,
      route: { navApp: 'kakao' },
    });

    expect(merged.route.navApp).toBe('google');
  });

  it('migrates once and persists the v2 payload', async () => {
    const store = new MemoryStore();
    store.values.set(
      SETTINGS_V1_KEY,
      JSON.stringify({ districtFees: { 강남구: 19000 } }),
    );
    const repository = new SettingsRepository(store);

    const first = await repository.get();
    const second = await repository.get();

    expect(first).toEqual(second);
    expect(first.fees.districtFees.Seoul.강남구).toBe(19000);
    expect(store.values.has(SETTINGS_V2_KEY)).toBe(true);
  });

  it('recovers from invalid stored JSON', async () => {
    const store = new MemoryStore();
    store.values.set(SETTINGS_V2_KEY, '{broken');

    const settings = await new SettingsRepository(store).get();

    expect(settings).toEqual(DEFAULT_ROUTELO_SETTINGS);
  });
});
