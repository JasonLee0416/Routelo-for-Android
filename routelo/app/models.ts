import type { LegacyDelivery } from './domain';

export type DeliveryStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'revisitNeeded';

// Compatibility shape for existing screens. Canonical persistence uses
// DeliveryOrder from app/domain and is converted through explicit adapters.
export type Delivery = LegacyDelivery;

export type FeeSettings = {
  districtFees: Record<string, number>;
  fuelEfficiency: number;
  themeMode: 'light' | 'dark';
  vehicleModel: string;
  fuelTankCapacity: number;
};

export type FuelLog = {
  id: string;
  date: string;
  pricePerLiter: number;
  liters: number;
  amount: number;
  odometerKm: number;
  vehicle?: string;
};

export type MileageLog = {
  id: string;
  date: string;
  odometerKm: number;
  dailyDistanceKm: number;
  vehicle?: string;
};

export type ContactChannel =
  | 'recipient'
  | 'orderingVendor'
  | 'fulfillingVendor'
  | 'other';

export type ContactLog = {
  id: string;
  deliveryId: string;
  channel: ContactChannel;
  label: string;
  phone: string;
  at: string;
};

export type OcrForm = {
  orderVendor: string;
  orderVendorTel: string;
  deliveryVendor: string;
  deliveryVendorTel: string;
  productName: string;
  productQuantity: string;
  eventTime: string;
  deliveryDt: string;
  deliveryAddress: string;
  customerRequests: string;
  recipientTel: string;
};

export type OcrFieldKey =
  | 'orderingVendorName'
  | 'orderingVendorTel'
  | 'fulfillingVendorName'
  | 'fulfillingVendorTel'
  | 'productName'
  | 'productQuantity'
  | 'ribbonText'
  | 'deliveryDate'
  | 'deliveryWindowStart'
  | 'deliveryWindowEnd'
  | 'strictTime'
  | 'eventTime'
  | 'venueName'
  | 'deliveryAddress'
  | 'recipientName'
  | 'recipientTel'
  | 'memo';

export type OcrFieldResult = {
  key: OcrFieldKey;
  label: string;
  value: string;
  rawValue?: string;
  confidence: number;
  required: boolean;
  sourceText: string;
  sourceLineIds?: string[];
  extractionMethod?: 'label' | 'layout' | 'pattern' | 'manual';
  validationErrors?: string[];
  alternatives: string[];
  status: 'confirmed' | 'review' | 'warning' | 'missing';
  phoneKind?: 'direct' | 'safe';
};

export type CaptureQuality = {
  score: number;
  blur: number;
  brightness: number;
  documentCoverage: number;
  skew: number;
  shadow: number;
  passed: boolean;
  messages: string[];
};

export type OcrPipelineResult = {
  engine: 'ppocrv5' | 'clova' | 'fixture';
  modelVersion?: string;
  rawText: string;
  recognizedLines?: Array<{
    text: string;
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    cornerPoints?: Array<{ x: number; y: number }>;
    confidence?: number;
  }>;
  fields: OcrFieldResult[];
  documentConfidence: number;
  quality: CaptureQuality;
  processingMs: number;
  variantsCompared: number;
  // 어떤 필드에도 매핑되지 않은 줄(라벨/값). 버리지 않고 보존한다(무손실).
  unmapped: { label: string; value: string }[];
  conflicts?: { keys: OcrFieldKey[]; message: string }[];
  cloudFallback?: { trigger: boolean; reasons: string[] };
  eventType?: {
    type: 'congratulation' | 'condolence' | 'opening' | 'other';
    confidence: number;
  };
};
