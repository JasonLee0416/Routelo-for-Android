import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  LocalDeliveryRepository,
  LocalContactLogRepository,
  LocalFuelLogRepository,
  LocalMileageLogRepository,
  LocalReceiptRepository,
  LocalRoutePlanRepository,
} from './local';

export const deliveryRepository = new LocalDeliveryRepository(AsyncStorage);
export const receiptRepository = new LocalReceiptRepository(AsyncStorage);
export const routePlanRepository = new LocalRoutePlanRepository(AsyncStorage);
export const fuelLogRepository = new LocalFuelLogRepository(AsyncStorage);
export const mileageLogRepository = new LocalMileageLogRepository(AsyncStorage);
export const contactLogRepository = new LocalContactLogRepository(AsyncStorage);
