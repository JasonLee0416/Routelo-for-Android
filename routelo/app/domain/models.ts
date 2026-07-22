export const DOMAIN_SCHEMA_VERSION = 1;
export const DEFAULT_TIMEZONE = 'Asia/Seoul';

export type DeliveryStatus =
  | 'draft'
  | 'reviewRequired'
  | 'pending'
  | 'completed'
  | 'failed'
  | 'revisitNeeded'
  | 'cancelled';

export type SchedulePrecision =
  | 'unknown'
  | 'date-only'
  | 'approximate'
  | 'exact';

export type DeliveryPriority = 'normal' | 'urgent' | 'critical';

export type VendorInfo = {
  name?: string;
  telephone?: string;
};

export type ProductCategory =
  | 'congratulation'
  | 'condolence'
  | 'plant'
  | 'other';

export type ProductInfo = {
  name?: string;
  category?: ProductCategory;
  quantity?: number;
  ribbonText?: string;
};

export type DeliverySchedule = {
  serviceDate?: string;
  timezone: string;
  deliveryWindow?: {
    startAt?: string;
    endAt?: string;
  };
  strictDeadlineAt?: string;
  eventAt?: string;
  plannedArrivalAt?: string;
  actualArrivalAt?: string;
  completedAt?: string;
  timePrecision: SchedulePrecision;
  priority: DeliveryPriority;
};

export type DeliveryDestination = {
  venueName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
};

export type RecipientInfo = {
  name?: string;
  telephone?: string;
};

export type SettlementInfo = {
  distanceKm?: number;
  fee?: number;
  district?: string;
};

// 'pending'은 증거(사진)만 수집되고 배송 결과는 아직 기록되지 않은 상태.
// 사진 첨부만으로 완료 처리되지 않도록 결과 상태와 분리한다.
export type ProofOfDeliveryStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'revisitNeeded';

export type ProofOfDelivery = {
  status: ProofOfDeliveryStatus;
  recordedAt: string;
  completedAt?: string;
  photoUris: string[];
  note?: string;
  failureReason?: string;
  signatureUri?: string;
};

export type DeliveryOrder = {
  schemaVersion: number;
  id: string;
  orderNumber?: string;
  orderingVendor: VendorInfo;
  fulfillingVendor: VendorInfo;
  product: ProductInfo;
  schedule: DeliverySchedule;
  destination: DeliveryDestination;
  recipient: RecipientInfo;
  customerRequests?: string;
  status: DeliveryStatus;
  proofOfDelivery?: ProofOfDelivery;
  settlement: SettlementInfo;
  source: {
    type: 'manual' | 'ocr' | 'migration' | 'sample';
    receiptId?: string;
    legacyId?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type OcrEngine = 'ppocrv5' | 'clova' | 'fixture';

export type OcrPoint = { x: number; y: number };

export type RecognizedLine = {
  id: string;
  text: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  cornerPoints?: OcrPoint[];
  confidence?: number;
};

export type ExtractionStatus =
  | 'missing'
  | 'candidate'
  | 'confirmed'
  | 'rejected';

export type ExtractionMethod = 'label' | 'layout' | 'pattern' | 'manual';

export type ExtractedField<T = string> = {
  value?: T;
  rawValue?: string;
  confidence: number;
  status: ExtractionStatus;
  sourceLineIds: string[];
  extractionMethod?: ExtractionMethod;
  validationErrors: string[];
  alternatives: T[];
};

export type FieldCorrection = {
  fieldKey: string;
  previousValue?: unknown;
  nextValue?: unknown;
  correctedAt: string;
};

export type ReceiptDocument<TFields extends Record<string, unknown> = Record<string, unknown>> = {
  schemaVersion: number;
  id: string;
  imageUri?: string;
  capturedAt: string;
  recognition: {
    engine: OcrEngine;
    processingMs: number;
    fullText: string;
    lines: RecognizedLine[];
  };
  extraction: {
    registryVersion: number;
    fields: TFields;
    unmappedLines: string[];
    documentConfidence: number;
  };
  review: {
    status: 'unreviewed' | 'reviewRequired' | 'approved' | 'rejected';
    reviewedAt?: string;
    corrections: FieldCorrection[];
  };
  linkedDeliveryId?: string;
};

export type RouteStop = {
  deliveryOrderId: string;
  sequence: number;
  plannedArrivalAt?: string;
  estimatedTravelMinutes?: number;
};

export type RoutePlan = {
  schemaVersion: number;
  id: string;
  serviceDate: string;
  timezone: string;
  generatedAt: string;
  stops: RouteStop[];
  totalDistanceKm?: number;
  estimatedDurationMinutes?: number;
};

export type CalendarDeliveryItem = {
  id: string;
  deliveryOrderId: string;
  date: string;
  startAt?: string;
  endAt?: string;
  deadlineAt?: string;
  eventAt?: string;
  plannedArrivalAt?: string;
  title: string;
  address: string;
  status: DeliveryStatus;
  priority: DeliveryPriority;
  timePrecision: SchedulePrecision;
  routeSequence?: number;
};
