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

// 별칭을 "라벨" 로 인정하려면 뒤에 구분자(콜론/슬래시/공백/줄끝)가 와야 한다.
// 이 경계가 없으면 '상품'이 '상품코드'를, '인수자'가 '인수자명'을 잘못 흡수한다.
// 별칭 내부 공백은 OCR 변형을 흡수하도록 \s* 로 유연화한다.
function labelPattern(alias: string) {
  const core = alias.trim().split(/\s+/).map(escapeRegExp).join('\\s*');
  return new RegExp(`^\\s*${core}\\s*(?:[:：|/]\\s*|\\s+|$)`, 'i');
}

// 값 앞에 다시 붙은 2차 라벨을 걷어낸다. 실제 인수증은 "배달장소: 주소 서울…",
// "인수자: 받는분 고 박희순", "리본: 경조사어: 삼가…" 처럼 라벨을 중첩 표기한다.
// ANY: 공백만으로도 제거해도 안전한 라벨(실제 값이 이 토큰으로 시작할 일이 거의 없음).
const SECONDARY_LABELS_ANY = [
  '주소',
  '받는분',
  '받는 분',
  '받으실분',
  '받으실 분',
  '경조사어',
];
// COLON: 실제 값이 이 토큰으로 시작할 수 있어(예: 화원명 "리본 플라워", 이름) 콜론
// 구분자가 명시된 경우에만 제거한다.
const SECONDARY_LABELS_COLON = ['리본문구', '리본', '성명', '이름'];

function labelPatternColon(alias: string) {
  const core = alias.trim().split(/\s+/).map(escapeRegExp).join('\\s*');
  return new RegExp(`^\\s*${core}\\s*[:：|/]\\s*`, 'i');
}

function stripRedundantLabels(value: string) {
  let current = value.trim();
  for (let guard = 0; guard < 10; guard += 1) {
    let stripped = false;
    for (const label of SECONDARY_LABELS_ANY) {
      const match = current.match(labelPattern(label));
      if (match && match[0].length < current.length) {
        current = current.slice(match[0].length).trim();
        stripped = true;
        break;
      }
    }
    if (!stripped) {
      for (const label of SECONDARY_LABELS_COLON) {
        const match = current.match(labelPatternColon(label));
        if (match && match[0].length < current.length) {
          current = current.slice(match[0].length).trim();
          stripped = true;
          break;
        }
      }
    }
    if (!stripped) break;
  }
  return current;
}

// [불명](unknownToken)만 남는 값은 사실상 빈 값이다 — 그대로 채우면 "명: [불명]"
// 같은 쓰레기가 필드에 들어간다. 불명 토큰을 제거해 알맹이가 없으면 빈 문자열.
function voidIfUnknown(value: string) {
  const withoutUnknown = value.replace(/\[?\s*불명\s*\]?/g, '');
  const residue = withoutUnknown.replace(/[·・.,/\-\s]+/g, '').trim();
  if (!residue) return '';
  // 불명 토큰 제거 후 남는 고아 구분자/중복 공백을 정리한다("070-[불명]"→"070").
  return withoutUnknown
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·・.,/\-]+|[\s·・.,/\-]+$/g, '')
    .trim();
}

function cleanFieldValue(value: string) {
  return voidIfUnknown(stripRedundantLabels(value));
}

// 실제 인수증의 발주/배송 화원은 전화·지역이 뒤섞인 복합 표기가 흔하다:
//  · KDFC 대시형: "경기 의정부시-경기의정21호(임플라워)-010-5898-9543"
//  · 네이버 대괄호형: "[서울 마포구] 가든스로즈블리 (HP:010-4482-9119)"
// 이런 값은 화원명 검증기(전화 포함 시 거절)에 걸려 통째로 버려진다. 화원명만
// 보수적으로 뽑아낸다(추출 실패 시 원본 유지 → 기존 검증기가 판단). 값은 review.
const FLORIST_SUFFIX = /(?:화원|플라워|농원|꽃집|꽃|원예|원|센터|flower)$/i;

// 담당자·지점 등 화원명이 아닌 괄호 내용은 제외한다(예: "행복플라워(대표 김철수)"
// 에서 대표명을 화원명으로 잘못 뽑지 않도록).
const NON_FLORIST_PAREN = /HP|TEL|FAX|전화|팩스|연락|대표|담당|직통|사장|실장|점장/i;

function refineVendorCandidate(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  // 1) 괄호 안 화원명 우선(마지막 괄호부터). 화원 접미사가 있는 것만 채택 —
  //    접미사가 없으면 지점/담당명일 수 있어 잘못 뽑는다.
  const parens = [...value.matchAll(/[（(]\s*([^()（）]+?)\s*[)）]/g)].map((m) =>
    m[1].trim(),
  );
  const floristParen = parens
    .filter((p) => !/\d/.test(p) && !NON_FLORIST_PAREN.test(p))
    .reverse()
    .find((p) => /[가-힣]/.test(p) && FLORIST_SUFFIX.test(p));
  if (floristParen) return floristParen;
  // 2) 대괄호 지역태그 또는 괄호(HP/전화 등)가 있을 때만 그것들을 제거해 이름을
  //    남긴다. 대괄호·괄호 없이 '전화만' 섞인 복합값은 원본을 유지해 기존 화원명
  //    검증기(전화 포함 시 거절)의 fail-closed 동작을 무너뜨리지 않는다.
  const hasBracket = /^\s*\[[^\]]*\]/.test(value);
  const hasParen = /[（(][^()（）]*[)）]/.test(value);
  if (hasBracket || hasParen) {
    const stripped = value
      .replace(/^\s*\[[^\]]*\]\s*/, '')
      .replace(/\s*[（(][^()（）]*[)）]\s*/g, ' ')
      .replace(PHONE_PATTERN, ' ')
      .replace(/[-–—·]+\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (stripped) return stripped;
  }
  return value;
}

function refineVendorSource<T extends { value: string } | undefined>(
  source: T,
): T {
  if (!source) return source;
  return { ...source, value: refineVendorCandidate(source.value) };
}

// ML Kit이 표의 여러 셀을 한 줄로 병합하면(예: "보내는 분 : … 경조사어 : … 받는분
// : …") 라인 단위 파서가 필드를 못 나눈다. 한 줄에 임베디드된 라벨 앞에서 잘라
// 세부 라인으로 분리한다.
//
// 안전 원칙(누락·오분할 방지): **콜론(:/：)이 붙은 사전 라벨만** 경계로 삼는다.
//  - 콜론 없는 공백 경계(예: "…빕니다 주소 서울")로는 절대 자르지 않는다. 값 안에
//    우연히 들어간 라벨 토큰(주소/배송지/리본 등)에서 잘려 값이 유실되는 것을 막기
//    위함. 그런 경우에도 findLabeledValue가 라인 내부에서 라벨을 찾아 값을 뽑으므로
//    배송지 인식은 유지된다(분리는 정확도를 높이는 보강일 뿐, 필수 조건이 아님).
//  - 선행 문자가 한글이거나 여는 괄호면 자르지 않는다: 복합어("회사주소:") 중간이나
//    "(HP:…)" 같은 괄호 안 부가 라벨을 새 필드로 오분할하지 않기 위함.
const EMBEDDED_LABELS = [
  ...new Set(
    DEFAULT_FIELD_REGISTRY.flatMap((def) => [def.label, ...def.aliases]).concat([
      '보내는분',
      '보내는 분',
      '주문자',
    ]),
  ),
].filter((label) => label.length >= 2);

const EMBEDDED_LABEL_CORE = EMBEDDED_LABELS.map((label) =>
  escapeRegExp(label.trim()).replace(/\s+/g, '\\s*'),
).join('|');
const EMBEDDED_LABEL_SPLIT = new RegExp(
  `(?=(?<![가-힣(])(?:${EMBEDDED_LABEL_CORE})\\s*[:：])`,
  'g',
);

function segmentByEmbeddedLabels(line: string): string[] {
  const parts = line
    .split(EMBEDDED_LABEL_SPLIT)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [line];
}

function findLabeledValue(lines: string[], aliases: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    for (const alias of [...aliases].sort(
      (left, right) => right.length - left.length,
    )) {
      const match = line.match(labelPattern(alias));
      if (!match) continue;
      const value = cleanFieldValue(line.slice(match[0].length).trim());
      if (!value || compactLabel(value) === compactLabel(alias)) {
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
  const cleaned = cleanFieldValue(lines[index].trim());
  return {
    value: cleaned || lines[index].trim(),
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
    .filter(Boolean)
    // 한 줄에 여러 라벨이 병합된 경우 라벨 경계로 쪼갠다(ML Kit 셀 병합 보완).
    .flatMap((line) => segmentByEmbeddedLabels(line));
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
    // 레지스트리 값에도 2차 라벨/불명 토큰 정리를 동일 적용한다.
    const value = cleanFieldValue((mapped[key] || '').trim());
    // sourceLineIds는 findLabeledValue와 형태를 맞추기 위해 빈 배열로 둔다
    // (레지스트리 매핑은 특정 원본 줄 인덱스를 보존하지 않는다).
    return value
      ? { value, sourceText: value, sourceLineIds: [] as string[] }
      : undefined;
  };

  const orderingVendor = refineVendorSource(
    findLabeledValue(lines, ['발주화원', '발주처', '발주회원']) ||
      registrySource('orderingVendorName'),
  );
  const fulfillingVendor = refineVendorSource(
    findLabeledValue(lines, ['배송화원', '수주화원', '수주회원']) ||
      registrySource('fulfillingVendorName'),
  );
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
      '리본',
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
    findLabeledValue(lines, [
      '받으실분',
      '받으실 분',
      '인수자명',
      '받는분',
      '받는 분',
      '수령인',
      '인수자',
    ]) || registrySource('recipientName');
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
