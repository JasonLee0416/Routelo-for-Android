import {
  CaptureQuality,
  OcrFieldKey,
  OcrFieldResult,
  OcrPipelineResult,
} from '../models';
import { fixConfusableDigits } from '../ocr/confusables';
import { DEFAULT_FIELD_REGISTRY } from '../ocr/fieldRegistry';
import { applyOfficialOcrFieldGuardrails } from '../ocr/fieldValidation';
import { buildLayoutText } from '../ocr/layout';
import { normalizeReceipt } from '../ocr/normalize';
import { enrichOcrPipelineResult } from './ocrMetadata';
import { applySpatialOcrFieldHeuristics } from './ocrSpatialHeuristics';

type ImageAssetInfo = {
  uri?: string;
  width?: number;
  height?: number;
  fileSize?: number;
};

type RecognizedText = {
  engine?: OcrPipelineResult['engine'];
  modelVersion?: string;
  fullText: string;
  processingMs: number;
  orientationDegrees?: 0 | 90 | 180 | 270;
  variantsCompared?: number;
  diagnostics?: OcrPipelineResult['ocrDiagnostics'];
  lines?: Array<{
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
};

type RecognizeImage = (imageUri: string) => Promise<RecognizedText>;

export class OcrRecognizerUnavailableError extends Error {
  constructor(
    message = '실제 OCR 인식 엔진을 사용할 수 없습니다. 촬영한 사진에서 임의의 정보를 생성하지 않습니다.',
  ) {
    super(message);
    this.name = 'OcrRecognizerUnavailableError';
  }
}

export class OcrNoTextDetectedError extends Error {
  constructor(
    message = '사진에서 인식 가능한 글자를 찾지 못했습니다. 인수증 전체가 선명하게 보이도록 다시 촬영해 주세요.',
  ) {
    super(
      message,
    );
    this.name = 'OcrNoTextDetectedError';
  }
}

const LABELS: Record<OcrFieldKey, string> = {
  orderingVendorName: '발주화원',
  orderingVendorTel: '발주화원 전화번호',
  fulfillingVendorName: '배송화원',
  fulfillingVendorTel: '배송화원 전화번호',
  productName: '상품명',
  productQuantity: '수량',
  ribbonText: '리본 문구',
  deliveryDate: '배송 날짜',
  deliveryWindowStart: '배송 시작 시간',
  deliveryWindowEnd: '배송 종료 시간',
  strictTime: '배달 엄수 시간',
  eventTime: '예식 시간',
  venueName: '상호명 / 예식장명',
  deliveryAddress: '배송 주소',
  recipientName: '수령자 / 담당자',
  recipientTel: '수령인 연락처',
  memo: '특이사항 / 메모',
};

const REQUIRED = new Set<OcrFieldKey>([
  'deliveryDate',
  'productName',
  'deliveryAddress',
]);

const PHONE_PATTERN =
  /(?<!\d)(?:01[016789][-\s]?\d{3,4}[-\s]?\d{4}|02[-\s]?\d{3,4}[-\s]?\d{4}|0[3-6]\d[-\s]?\d{3,4}[-\s]?\d{4})(?!\d)/g;
const VALID_PHONE =
  /^(?:01[016789]-\d{3,4}-\d{4}|02-\d{3,4}-\d{4}|0[3-6]\d-\d{3,4}-\d{4})$/;

const normalizeTime = (value: string) => {
  const compact = fixConfusableDigits(value.replace(/\s/g, ''));
  const colon = compact.match(/(\d{1,2}):(\d{2})/);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${colon[2]}`;
    }
    return '';
  }
  const korean = compact.match(/(오전|오후)?(\d{1,2})시(?:(\d{1,2})분)?/);
  if (!korean) return '';
  let hour = Number(korean[2]);
  const minute = Number(korean[3] || 0);
  if (hour > 23 || minute > 59) return '';
  if (korean[1] === '오후' && hour < 12) hour += 12;
  if (korean[1] === '오전' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('010') && digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.startsWith('02') && (digits.length === 9 || digits.length === 10)) {
    return `${digits.slice(0, 2)}-${digits.slice(2, -4)}-${digits.slice(-4)}`;
  }
  if (/^0[3-6]\d/.test(digits) && (digits.length === 10 || digits.length === 11)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}`;
  }
  return '';
};

const allMatches = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((match) => match[0]);

function field(
  key: OcrFieldKey,
  value: string,
  confidence: number,
  sourceText: string,
  alternatives: string[] = [],
  options: {
    sourceLineIds?: string[];
    extractionMethod?: OcrFieldResult['extractionMethod'];
    validationErrors?: string[];
    forceReview?: boolean;
  } = {},
): OcrFieldResult {
  const validationErrors = options.validationErrors || [];
  const status: OcrFieldResult['status'] = !value
    ? 'missing'
    : validationErrors.length
      ? 'warning'
      : options.forceReview
        ? 'review'
        : confidence >= 85
          ? 'confirmed'
          : confidence >= 60
            ? 'review'
            : 'warning';
  return {
    key,
    label: LABELS[key],
    value,
    rawValue: sourceText || undefined,
    confidence: value ? confidence : 0,
    required: REQUIRED.has(key),
    sourceText,
    sourceLineIds: options.sourceLineIds,
    extractionMethod: options.extractionMethod,
    validationErrors,
    alternatives,
    status,
  };
}

const RECEIPT_EVIDENCE_PATTERNS = [
  /(?:발주|배송|배달|수령|인수|받는\s*분|주문|상품|화환|리본|요청|메모|비고|예식|행사|엄수|주소|전화|연락처)/u,
  /(?:서울|경기|인천|부산|대구|대전|광주|울산|세종|제주)\s*[가-힣0-9\s]*(?:시|군|구|동|로|길)/u,
  /(?:01[016789]|02|0[3-6]\d)[-\s]?\d{3,4}[-\s]?\d{4}/,
  /20\d{2}[.\-/년\s]\s*\d{1,2}[.\-/월\s]\s*\d{1,2}/,
  /(?:오전|오후)?\s*\d{1,2}\s*(?::|시)\s*\d{0,2}\s*(?:분|까지)?/u,
];

const CORE_EVIDENCE_KEYS = new Set<OcrFieldKey>([
  'orderingVendorName',
  'orderingVendorTel',
  'fulfillingVendorName',
  'fulfillingVendorTel',
  'productName',
  'deliveryDate',
  'deliveryAddress',
  'recipientName',
  'recipientTel',
]);

function receiptEvidenceScore(rawText: string) {
  const compactText = rawText.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!compactText) return 0;
  return RECEIPT_EVIDENCE_PATTERNS.reduce(
    (score, pattern) => score + (pattern.test(compactText) ? 1 : 0),
    0,
  );
}

function usableCoreFieldCount(fields: OcrFieldResult[]) {
  return fields.filter(
    (fieldResult) =>
      CORE_EVIDENCE_KEYS.has(fieldResult.key) &&
      fieldResult.value.trim() &&
      fieldResult.confidence >= 70 &&
      fieldResult.status !== 'warning',
  ).length;
}

function assertUsefulOcrEvidence(
  rawText: string,
  parsed: OcrPipelineResult,
) {
  const evidenceScore = receiptEvidenceScore(rawText);
  const coreFieldCount = usableCoreFieldCount(parsed.fields);
  if (evidenceScore >= 2 || coreFieldCount >= 2) return;
  throw new OcrNoTextDetectedError(
    'OCR이 인수증 핵심 근거를 충분히 찾지 못했습니다. 상호명, 주소, 전화번호 중 최소 2개 이상의 근거가 잡히기 전에는 자동 등록하지 않습니다.',
  );
}

const compactLabel = (value: string) =>
  value.replace(/[\s:：|[\]()]/g, '').toLowerCase();

const lineId = (index: number) => `line-${index + 1}`;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLabeledValue(lines: string[], aliases: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const alias of [...aliases].sort(
      (left, right) => right.length - left.length,
    )) {
      if (!compactLabel(line).startsWith(compactLabel(alias))) continue;
      const value = line
        .replace(
          new RegExp(`^\\s*${escapeRegExp(alias)}\\s*[:：|]?\\s*`, 'i'),
          '',
        )
        .trim();
      if (
        !value ||
        value === line.trim() ||
        compactLabel(value) === compactLabel(alias)
      ) {
        continue;
      }
      return {
        value,
        sourceText: line,
        sourceLineIds: [lineId(index)],
      };
    }
  }
  return undefined;
}

function firstMatchingLine(
  lines: string[],
  predicate: (line: string) => boolean,
) {
  const index = lines.findIndex(predicate);
  if (index < 0) return undefined;
  return {
    value: lines[index],
    sourceText: lines[index],
    sourceLineIds: [lineId(index)],
  };
}

function validatedPhoneCandidate(
  candidate: ReturnType<typeof findLabeledValue>,
) {
  if (!candidate) return undefined;
  // 전화 문맥에서 O→0, I/l→1 등 혼동 문자를 숫자로 교정한 뒤 패턴 추출.
  const value = allMatches(fixConfusableDigits(candidate.value), PHONE_PATTERN)
    .map(normalizePhone)
    .find((phone) => VALID_PHONE.test(phone));
  return value ? { ...candidate, value } : undefined;
}

function safeRecipientName(value: string) {
  const trimmed = value.trim();
  if (
    !trimmed ||
    /플라워|화원|반드시|이름|성명|수령자|인수자|받는분|받는 분/.test(
      trimmed,
    )
  ) {
    return '';
  }
  return trimmed.replace(/\s*(실장|팀장|담당자)$/, ' $1');
}

function normalizeQuantity(rawValue: string) {
  const value = fixConfusableDigits(rawValue);
  const explicit = value.match(/수량\s*[|:]?\s*(\d{1,2})/);
  const count = explicit || value.match(/(\d{1,2})\s*개/);
  const quantity = count ? Number(count[1]) : NaN;
  return Number.isInteger(quantity) && quantity > 0 && quantity <= 99
    ? String(quantity)
    : '';
}

function normalizeDate(rawText: string) {
  const text = fixConfusableDigits(rawText);
  const exact = text.match(/20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/)?.[0];
  if (!exact) return '';
  const [year, month, day] = exact.split(/[.\-/]/).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return '';
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeReceiptDate(rawText: string) {
  const text = fixConfusableDigits(rawText);
  const korean = text.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) {
    const [year, month, day] = [
      Number(korean[1]),
      Number(korean[2]),
      Number(korean[3]),
    ];
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return normalizeDate(text);
}

function normalizeReceiptTime(value: string) {
  const compact = value.replace(/\s/g, '');
  const colon = compact.match(/(\d{1,2}):(\d{2})/);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }
  const korean = compact.match(/(오전|오후)?(\d{1,2})시(?:(\d{1,2})분?)?/);
  if (korean) {
    let hour = Number(korean[2]);
    const minute = Number(korean[3] || 0);
    if (hour <= 23 && minute <= 59) {
      if (korean[1] === '오후' && hour < 12) hour += 12;
      if (korean[1] === '오전' && hour === 12) hour = 0;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }
  return '';
}

function normalizeReceiptQuantity(value: string) {
  const explicit = value.match(/수량\s*[|:]?\s*(\d{1,2})/);
  const count = explicit || value.match(/(\d{1,2})\s*(?:개|단|EA|ea)/);
  const quantity = count ? Number(count[1]) : NaN;
  if (Number.isInteger(quantity) && quantity > 0 && quantity <= 99) {
    return String(quantity);
  }
  return normalizeQuantity(value);
}

function safeReceiptRecipientName(value: string) {
  const trimmed = value.trim();
  if (
    !trimmed ||
    /화원|반드시|이름|서명|수령|인수|받는분|받는 분/.test(trimmed)
  ) {
    return '';
  }
  return safeRecipientName(trimmed);
}

export function inspectCaptureQuality(asset: ImageAssetInfo): CaptureQuality {
  const width = asset.width;
  const height = asset.height;
  const shortestSide = Math.min(width || 0, height || 0);
  const longestSide = Math.max(width || 0, height || 0);
  const messages = [
    '실제 이미지 픽셀을 분석하지 못해 선명도, 밝기, 문서 영역, 기울기, 그림자 점수를 신뢰할 수 없습니다.',
  ];

  if (!width || !height) {
    messages.push('이미지 해상도 정보도 없어 재촬영 또는 다른 사진 선택이 필요합니다.');
  } else if (shortestSide < 1080) {
    messages.push('이미지의 짧은 변이 작습니다. 인수증을 더 가까이 촬영해야 합니다.');
  }

  return {
    score: 0,
    blur: 0,
    brightness: 0,
    documentCoverage:
      shortestSide && longestSide
        ? Math.round(Math.min(100, (shortestSide / longestSide) * 100))
        : 0,
    skew: 0,
    shadow: 0,
    passed: false,
    messages,
    measured: false,
    metrics: {
      width,
      height,
    },
  };
}

export function parseReceiptText(
  rawText: string,
  quality: CaptureQuality,
): OcrPipelineResult {
  const started = Date.now();
  const text = rawText.replace(/[ \t]+/g, ' ').trim();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const { fields: mapped, unmapped } = normalizeReceipt(
    lines,
    DEFAULT_FIELD_REGISTRY,
  );

  // 레지스트리 폴백: normalizeReceipt(mapped)는 별칭 사전 + 부분일치 + 편집거리로
  // 라벨을 정규 필드에 매핑하는데, 지금까지 parseReceiptText가 deliveryDate 외에는
  // 이 결과를 전부 버려 사실상 죽은 코드였다. 아래 하드코딩 findLabeledValue가
  // 놓친 '빈 필드만' mapped 값으로 채운다(하드코딩 우선, 레지스트리는 보강).
  // 복구값은 여전히 forceReview→status 'review'로 표시되므로 zero-fabrication 유지.
  const registrySource = (key: keyof typeof mapped) => {
    const value = mapped[key]?.trim();
    // sourceLineIds는 findLabeledValue와 형태를 맞추기 위해 빈 배열로 둔다
    // (레지스트리 매핑은 특정 원본 줄 인덱스를 보존하지 않는다).
    return value
      ? { value, sourceText: value, sourceLineIds: [] as string[] }
      : undefined;
  };

  const orderingVendor =
    findLabeledValue(lines, ['발주화원', '발주처', '발주회원']) ||
    registrySource('orderingVendorName');
  const fulfillingVendor =
    findLabeledValue(lines, ['배송화원', '수주화원', '수주회원']) ||
    registrySource('fulfillingVendorName');
  // 명시 라벨로 잡힌 전화만 확정(confirmed) 대상이고, 레지스트리 퍼지 폴백으로
  // 복구된 전화는 검토(review)로만 둔다(zero-fabrication). `||`가 검증 전에
  // 하드코딩/레지스트리 중 하나로 확정되므로, 하드코딩 miss 여부가 곧 폴백 출처다.
  const orderingVendorTelLabeled = findLabeledValue(lines, [
    '발주화원 전화',
    '발주처 전화',
    '발주 전화',
  ]);
  const orderingVendorTel = validatedPhoneCandidate(
    orderingVendorTelLabeled || registrySource('orderingVendorTel'),
  );
  const orderingVendorTelFromRegistry = !orderingVendorTelLabeled;
  const fulfillingVendorTelLabeled = findLabeledValue(lines, [
    '배송화원 전화',
    '수주화원 전화',
    '배송 전화',
  ]);
  const fulfillingVendorTel = validatedPhoneCandidate(
    fulfillingVendorTelLabeled || registrySource('fulfillingVendorTel'),
  );
  const fulfillingVendorTelFromRegistry = !fulfillingVendorTelLabeled;

  const productSource =
    findLabeledValue(lines, ['상품명', '배송상품', '품명', '상품']) ||
    firstMatchingLine(lines, (line) =>
      /(?:축하|근조).*(?:화환|3단)|화환.*(?:축하|근조|3단)/.test(line),
    ) ||
    registrySource('productName');
  const quantitySource =
    findLabeledValue(lines, ['수량', '개수', '갯수']) ||
    (productSource && /\d+\s*(?:개|단|EA|ea)/.test(productSource.value)
      ? productSource
      : undefined) ||
    registrySource('productQuantity');
  const ribbonSource =
    findLabeledValue(lines, [
      '리본문구',
      '리본 문구',
      '리본메세지',
      '리본메시지',
      '경조사어',
    ]) ||
    firstMatchingLine(lines, (line) =>
      /삼가.*(?:명복|조의)|축하.*(?:결혼|개업)|부활/.test(line),
    ) ||
    registrySource('ribbonText');

  const dateSource =
    findLabeledValue(lines, ['배달일시', '배달일자', '배송일시', '배송일자']) ||
    firstMatchingLine(lines, (line) =>
      /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}|20\d{2}년\s*\d{1,2}월\s*\d{1,2}일/.test(
        line,
      ),
    );
  const deliveryDate = normalizeReceiptDate(
    dateSource?.value || mapped.deliveryDate || text,
  );
  const range = text.match(
    /(\d{1,2}:\d{2})\s*[~～\-]\s*(\d{1,2})\s*:?\s*(\d{2})/,
  );
  const deliveryWindowStart = range ? normalizeReceiptTime(range[1]) : '';
  const deliveryWindowEnd = range
    ? normalizeReceiptTime(`${range[2]}:${range[3]}`)
    : '';

  const strictSource = findLabeledValue(lines, [
    '시간엄수',
    '엄수시간',
    '배달 엄수',
    '까지 배송',
  ]);
  const eventSource =
    findLabeledValue(lines, ['예식 시간', '예식시간', '예식', '본식', '행사시간']) ||
    firstMatchingLine(lines, (line) =>
      /예식\s*[:：]?\s*\d{1,2}시|\(\s*\d{1,2}시\s*\d{0,2}분?\s*식\s*\)/.test(line),
    );
  const strictTime = strictSource
    ? normalizeReceiptTime(strictSource.value)
    : '';
  const eventTime = eventSource ? normalizeReceiptTime(eventSource.value) : '';

  const venueSource =
    findLabeledValue(lines, ['업체명', '상호명', '예식장', '웨딩홀', '배송처']) ||
    registrySource('venueName');
  const addressSource =
    findLabeledValue(lines, ['배송주소', '배달주소', '배송지', '배달장소', '주소']) ||
    firstMatchingLine(lines, (line) =>
      /(?:서울|경기)\s+[\p{Script=Hangul}\d\- ]+(?:구|시|군)\s+/u.test(line),
    ) ||
    registrySource('deliveryAddress');
  const recipientSource =
    findLabeledValue(lines, ['받는분', '받는 분', '수령인', '인수자']) ||
    registrySource('recipientName');
  const recipientName = safeReceiptRecipientName(recipientSource?.value || '');
  const recipientTelSource = validatedPhoneCandidate(
    findLabeledValue(lines, [
      '수령인 전화',
      '인수자 전화',
      '받는분 전화',
      '받는 분 전화',
      '수령자 연락처',
      '인수자 연락처',
      '핸드폰',
    ]) || registrySource('recipientTel'),
  );
  const phoneAlternatives = allMatches(text, PHONE_PATTERN)
    .map(normalizePhone)
    .filter((phone) => VALID_PHONE.test(phone));
  const memoSource =
    findLabeledValue(lines, [
      '요청사항',
      '요구사항',
      '특이사항',
      '메모',
      '주의',
      '비고',
    ]) || registrySource('memo');
  const memo =
    memoSource && !allMatches(memoSource.value, PHONE_PATTERN).length
      ? memoSource.value
      : '';

  const fields: OcrFieldResult[] = applyOfficialOcrFieldGuardrails([
    field(
      'orderingVendorName',
      orderingVendor?.value || '',
      orderingVendor ? 78 : 0,
      orderingVendor?.sourceText || '',
      [],
      {
        sourceLineIds: orderingVendor?.sourceLineIds,
        extractionMethod: orderingVendor ? 'label' : undefined,
        forceReview: true,
      },
    ),
    field(
      'orderingVendorTel',
      orderingVendorTel?.value || '',
      orderingVendorTel ? 90 : 0,
      orderingVendorTel?.sourceText || '',
      [],
      {
        sourceLineIds: orderingVendorTel?.sourceLineIds,
        extractionMethod: orderingVendorTel ? 'label' : undefined,
        forceReview: orderingVendorTelFromRegistry,
      },
    ),
    field(
      'fulfillingVendorName',
      fulfillingVendor?.value || '',
      fulfillingVendor ? 78 : 0,
      fulfillingVendor?.sourceText || '',
      [],
      {
        sourceLineIds: fulfillingVendor?.sourceLineIds,
        extractionMethod: fulfillingVendor ? 'label' : undefined,
        forceReview: true,
      },
    ),
    field(
      'fulfillingVendorTel',
      fulfillingVendorTel?.value || '',
      fulfillingVendorTel ? 90 : 0,
      fulfillingVendorTel?.sourceText || '',
      [],
      {
        sourceLineIds: fulfillingVendorTel?.sourceLineIds,
        extractionMethod: fulfillingVendorTel ? 'label' : undefined,
        forceReview: fulfillingVendorTelFromRegistry,
      },
    ),
    field(
      'productName',
      productSource?.value || '',
      productSource ? 82 : 0,
      productSource?.sourceText || '',
      [],
      {
        sourceLineIds: productSource?.sourceLineIds,
        extractionMethod: productSource ? 'pattern' : undefined,
        forceReview: true,
      },
    ),
    field(
      'productQuantity',
      normalizeReceiptQuantity(quantitySource?.value || ''),
      quantitySource ? 78 : 0,
      quantitySource?.sourceText || '',
      [],
      {
        sourceLineIds: quantitySource?.sourceLineIds,
        extractionMethod: quantitySource ? 'pattern' : undefined,
        forceReview: true,
      },
    ),
    field(
      'ribbonText',
      ribbonSource?.value || '',
      ribbonSource ? 76 : 0,
      ribbonSource?.sourceText || '',
      [],
      {
        sourceLineIds: ribbonSource?.sourceLineIds,
        extractionMethod: ribbonSource ? 'pattern' : undefined,
        forceReview: true,
      },
    ),
    field(
      'deliveryDate',
      deliveryDate,
      deliveryDate ? 92 : 0,
      dateSource?.sourceText || mapped.deliveryDate || '',
      [],
      {
        sourceLineIds: dateSource?.sourceLineIds,
        extractionMethod: deliveryDate ? 'pattern' : undefined,
        forceReview: !mapped.deliveryDate,
      },
    ),
    field(
      'deliveryWindowStart',
      deliveryWindowStart,
      deliveryWindowStart ? 88 : 0,
      range?.[0] || '',
      [],
      {
        extractionMethod: deliveryWindowStart ? 'pattern' : undefined,
        forceReview: true,
      },
    ),
    field(
      'deliveryWindowEnd',
      deliveryWindowEnd,
      deliveryWindowEnd ? 88 : 0,
      range?.[0] || '',
      [],
      {
        extractionMethod: deliveryWindowEnd ? 'pattern' : undefined,
        forceReview: true,
      },
    ),
    field(
      'strictTime',
      strictTime,
      strictTime ? 86 : 0,
      strictSource?.sourceText || '',
      [],
      {
        sourceLineIds: strictSource?.sourceLineIds,
        extractionMethod: strictTime ? 'label' : undefined,
        forceReview: true,
      },
    ),
    field(
      'eventTime',
      eventTime,
      eventTime ? 86 : 0,
      eventSource?.sourceText || '',
      [],
      {
        sourceLineIds: eventSource?.sourceLineIds,
        extractionMethod: eventTime ? 'label' : undefined,
        forceReview: true,
      },
    ),
    field(
      'venueName',
      venueSource?.value || '',
      venueSource ? 80 : 0,
      venueSource?.sourceText || '',
      [],
      {
        sourceLineIds: venueSource?.sourceLineIds,
        extractionMethod: venueSource ? 'label' : undefined,
        forceReview: true,
      },
    ),
    field(
      'deliveryAddress',
      addressSource?.value || '',
      addressSource ? 84 : 0,
      addressSource?.sourceText || '',
      [],
      {
        sourceLineIds: addressSource?.sourceLineIds,
        extractionMethod: addressSource ? 'pattern' : undefined,
        forceReview: true,
      },
    ),
    field(
      'recipientName',
      recipientName,
      recipientName ? 82 : 0,
      recipientSource?.sourceText || '',
      [],
      {
        sourceLineIds: recipientSource?.sourceLineIds,
        extractionMethod: recipientName ? 'label' : undefined,
        forceReview: true,
      },
    ),
    field(
      'recipientTel',
      recipientTelSource?.value || '',
      recipientTelSource ? 90 : 0,
      recipientTelSource?.sourceText || '',
      phoneAlternatives,
      {
        sourceLineIds: recipientTelSource?.sourceLineIds,
        extractionMethod: recipientTelSource ? 'label' : undefined,
        forceReview: true,
      },
    ),
    field(
      'memo',
      memo,
      memo ? 78 : 0,
      memoSource?.sourceText || '',
      [],
      {
        sourceLineIds: memoSource?.sourceLineIds,
        extractionMethod: memo ? 'label' : undefined,
        forceReview: true,
      },
    ),
  ]);

  const requiredFields = fields.filter((item) => item.required);
  const documentConfidence = Math.round(
    requiredFields.reduce((sum, item) => sum + item.confidence, 0) /
      Math.max(requiredFields.length, 1),
  );
  return enrichOcrPipelineResult({
    engine: 'fixture',
    rawText: text,
    fields,
    documentConfidence,
    quality,
    processingMs: Date.now() - started,
    variantsCompared: 1,
    unmapped,
  });
}

export async function runReceiptOcr(
  asset: ImageAssetInfo,
  rawText?: string,
  recognizeImage?: RecognizeImage,
  qualityOverride?: CaptureQuality,
): Promise<OcrPipelineResult> {
  const quality = qualityOverride || inspectCaptureQuality(asset);
  if (rawText?.trim()) {
    return parseReceiptText(rawText, quality);
  }
  if (!asset.uri?.trim()) {
    throw new OcrRecognizerUnavailableError('촬영한 인수증 이미지가 없습니다.');
  }

  try {
    const recognize =
      recognizeImage ||
      (async (imageUri: string) => {
        const { recognizeReceiptWithPpOcr } = await import('./recognizer');
        return recognizeReceiptWithPpOcr(imageUri);
    });
    const recognized = await recognize(asset.uri);
    if (!recognized.fullText.trim()) {
      const regionCount = recognized.diagnostics?.regionCount;
      const acceptedLineCount = recognized.diagnostics?.acceptedLineCount;
      const profile = recognized.diagnostics?.preprocessProfileId;
      throw new OcrNoTextDetectedError(
        [
          'OCR 엔진이 읽을 수 있는 한글 텍스트를 만들지 못했습니다.',
          profile ? `profile=${profile}` : undefined,
          typeof regionCount === 'number' ? `detectedRegions=${regionCount}` : undefined,
          typeof acceptedLineCount === 'number' ? `acceptedLines=${acceptedLineCount}` : undefined,
          '카메라 품질, DB text detector, recognizer/CTC 중 어느 단계가 실패했는지 진단값을 확인해야 합니다.',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
    const layoutText = buildLayoutText(
      recognized.lines || [],
      recognized.fullText,
    );
    const textForParsing =
      receiptEvidenceScore(layoutText) >= receiptEvidenceScore(recognized.fullText)
        ? layoutText
        : recognized.fullText;
    const parsed = applySpatialOcrFieldHeuristics(
      parseReceiptText(textForParsing, quality),
      recognized.lines || [],
      {
        width: asset.width,
        height: asset.height,
      },
    );
    assertUsefulOcrEvidence(textForParsing, parsed);
    return enrichOcrPipelineResult({
      ...parsed,
      engine: recognized.engine || 'ppocrv5',
      modelVersion: recognized.modelVersion,
      recognizedLines: recognized.lines,
      processingMs: recognized.processingMs,
      variantsCompared:
        'variantsCompared' in recognized
          ? recognized.variantsCompared ?? parsed.variantsCompared
          : parsed.variantsCompared,
      ocrDiagnostics: {
        ...recognized.diagnostics,
        rawTextLength: textForParsing.length,
      },
    });
  } catch (error) {
    if (error instanceof OcrNoTextDetectedError) throw error;
    throw new OcrRecognizerUnavailableError(
      error instanceof Error
        ? `OCR 엔진 실행에 실패했습니다: ${error.message}`
        : undefined,
    );
  }
}
