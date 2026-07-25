import {
  OcrFieldKey,
  OcrFieldResult,
  OcrPipelineResult,
} from '../models';
import { fixConfusableDigits } from '../ocr/confusables';
import { applyOfficialOcrFieldGuardrails } from '../ocr/fieldValidation';

export type SpatialOcrLine = {
  text: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence?: number;
};

export type SpatialHeuristicConstants = {
  sameRowYRatio: number;
  xLeftSlackRatio: number;
  xRightGrowRatio: number;
  yUpSlackRatio: number;
  yDownGrowRatio: number;
  maxCandidatesPerAnchor: number;
};

export type SpatialFieldCandidate = {
  key: OcrFieldKey;
  value: string;
  rawValue: string;
  confidence: number;
  sourceText: string;
  sourceLineIds: string[];
  anchorText?: string;
  extractionMethod: 'layout';
};

type PositionedLine = SpatialOcrLine & {
  id: string;
  boundingBox: NonNullable<SpatialOcrLine['boundingBox']>;
  centerX: number;
  centerY: number;
  right: number;
  bottom: number;
};

const FIELD_LABELS: Record<OcrFieldKey, string> = {
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

export const DEFAULT_SPATIAL_HEURISTIC_CONSTANTS: SpatialHeuristicConstants = {
  sameRowYRatio: 0.022,
  xLeftSlackRatio: 0.028,
  xRightGrowRatio: 0.72,
  yUpSlackRatio: 0.082,
  yDownGrowRatio: 0.105,
  maxCandidatesPerAnchor: 3,
};

const ANCHOR_ALIASES: Partial<Record<OcrFieldKey, string[]>> = {
  orderingVendorName: ['발주화원', '발주처', '발주회원', '주처'],
  fulfillingVendorName: ['배송화원', '배송처', '수주회원', '수주처'],
  productName: ['상품명', '품명', '배송상품'],
  productQuantity: ['수량', '개수'],
  ribbonText: ['리본', '리본메세지', '리본메시지', '경조사어'],
  deliveryDate: ['배달일시', '배달일사', '배송일시', '배달일자', '배송일자', '매릴홀시'],
  eventTime: ['예식', '식', '시간엄수'],
  deliveryAddress: ['배달장소', '배송장소', '배달주소', '배송주소', '배송지', '주소'],
  recipientName: ['받는분', '받으실분', '인수자', '인수자명'],
  recipientTel: ['전화', '핸드폰', '휴대폰', 'HP', 'TEL'],
  memo: ['요구사항', '요청사항', '특이사항', '비고'],
};

const PHONE_PATTERN =
  /(?<!\d)(?:01[016789][-\s]?\d{3,4}[-\s]?\d{4}|02[-\s]?\d{3,4}[-\s]?\d{4}|0[3-6]\d[-\s]?\d{3,4}[-\s]?\d{4})(?!\d)/g;

const ADDRESS_HINT =
  /(?:서울|서을|경기|인천|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|부산|대구|대전|광주|울산|세종|제주|구로구|영등포구|열등포구|엉등포구|마포구|동작구|강서구|용인시|의정부시|[가-힣]{1,12}(?:시|군|구)\s|[가-힣0-9]{1,20}(?:로|길)\s*\d|병원|장례식장|웨딩|호텔|예식장|홀|호실|층)/u;

const ADDRESS_EXCLUDE_HINT = /(?:반드시|정자로|이름으로|받는분|받으실분|인수자|관계)/u;

const PRODUCT_HINT =
  /(?:화환|근조|축하|축화|조화|꽃바구니|꽃다발|분화|개업|부고|경조|3단|FA\d+|FB\d+)/iu;

const NON_VALUE_HINT =
  /^(?:인수증|관계|선|시|분|TEL|HP|FAX|NAVER|BESTFLOWER|KDFC|99FLOWER)$/i;

const SEPARATOR_CHARS = new Set([
  ':',
  '|',
  '[',
  ']',
  '(',
  ')',
  '{',
  '}',
  '<',
  '>',
  '·',
  'ㆍ',
  '.',
  ',',
  '/',
  '\\',
  '_',
  '-',
]);

function removeSeparators(value: string) {
  return [...value].filter((char) => !/\s/u.test(char) && !SEPARATOR_CHARS.has(char)).join('');
}

function trimLeadingSeparators(value: string) {
  const chars = [...value];
  const firstValueIndex = chars.findIndex(
    (char) => !/\s/u.test(char) && !SEPARATOR_CHARS.has(char),
  );
  return firstValueIndex < 0 ? '' : chars.slice(firstValueIndex).join('');
}

function looksLikeAddress(value: string) {
  const text = value.normalize('NFKC');
  const compacted = removeSeparators(text);
  return (
    ADDRESS_HINT.test(text) ||
    ['서울', '서을', '경기', '인천', '구로구', '영등포구', '열등포구', '엉등포구'].some(
      (hint) => text.includes(hint),
    ) ||
    /[가-힣]{1,12}(?:시|군|구)\s/u.test(text) ||
    /(?:로|길)\s*\d/u.test(text) ||
    /(병원|장례식장|웨딩|호텔|예식장|홀|호실|층)/u.test(compacted)
  );
}

const compact = (value: string) =>
  removeSeparators(value.normalize('NFKC')).toLowerCase();

const cleanValue = (value: string) =>
  trimLeadingSeparators(value.normalize('NFKC').replace(/\s+/g, ' ')).trim();

const normalizePhone = (value: string) => {
  const digits = fixConfusableDigits(value).replace(/\D/g, '');
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

const normalizeDate = (value: string, fallbackYear = new Date().getFullYear()) => {
  const text = fixConfusableDigits(value.normalize('NFKC'));
  const korean = text.match(/(?:(20\d{2})\s*년)?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const separated = text.match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  const match = korean || separated;
  if (!match) return '';
  const year = Number(match[1] || fallbackYear);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return '';
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const normalizeTime = (value: string) => {
  const text = fixConfusableDigits(value.normalize('NFKC')).replace(/\s+/g, '');
  const colon = text.match(/(\d{1,2}):(\d{2})/);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }
  const korean = text.match(/(\d{1,2})시(?:(\d{1,2})분?)?/);
  if (!korean) return '';
  const hour = Number(korean[1]);
  const minute = Number(korean[2] || 0);
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const normalizeQuantity = (value: string) => {
  const text = fixConfusableDigits(value);
  const match = text.match(/(?:수량\s*[|:]?\s*)?(\d{1,2})\s*(?:개|EA|ea)?/);
  const quantity = match ? Number(match[1]) : NaN;
  return Number.isInteger(quantity) && quantity > 0 && quantity <= 99
    ? String(quantity)
    : '';
};

function positionedLines(lines: SpatialOcrLine[]) {
  return lines
    .map((line, index) => {
      if (!line.text.trim() || !line.boundingBox) return undefined;
      const box = line.boundingBox;
      return {
        ...line,
        id: `line-${index + 1}`,
        boundingBox: box,
        centerX: box.x + box.width / 2,
        centerY: box.y + box.height / 2,
        right: box.x + box.width,
        bottom: box.y + box.height,
      };
    })
    .filter((line): line is PositionedLine => Boolean(line));
}

function inferDimensions(lines: PositionedLine[], width?: number, height?: number) {
  const inferredWidth = Math.max(1, ...lines.map((line) => line.right));
  const inferredHeight = Math.max(1, ...lines.map((line) => line.bottom));
  return {
    width: width && width > 0 ? width : inferredWidth,
    height: height && height > 0 ? height : inferredHeight,
  };
}

function hasAnchor(text: string, key: OcrFieldKey) {
  const normalized = compact(text);
  return (ANCHOR_ALIASES[key] || []).some((alias) => normalized.includes(compact(alias)));
}

function stripInlineLabel(text: string, key: OcrFieldKey) {
  let value = text;
  for (const alias of ANCHOR_ALIASES[key] || []) {
    value = value.replace(new RegExp(`^\\s*${escapeRegExp(alias)}\\s*[:|]?\\s*`, 'iu'), '');
  }
  return cleanValue(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLikelyLabelOnly(text: string) {
  const value = cleanValue(text);
  if (!value) return true;
  if (NON_VALUE_HINT.test(value)) return true;
  return Object.keys(ANCHOR_ALIASES).some((key) => {
    const aliases = ANCHOR_ALIASES[key as OcrFieldKey] || [];
    return aliases.some((alias) => compact(value) === compact(alias));
  });
}

function candidateWindow(
  anchor: PositionedLine,
  candidate: PositionedLine,
  dimensions: { width: number; height: number },
  constants: SpatialHeuristicConstants,
) {
  const leftLimit = anchor.right - dimensions.width * constants.xLeftSlackRatio;
  const rightLimit = anchor.right + dimensions.width * constants.xRightGrowRatio;
  const topLimit = anchor.centerY - dimensions.height * constants.yUpSlackRatio;
  const bottomLimit = anchor.centerY + dimensions.height * constants.yDownGrowRatio;
  return (
    candidate.id !== anchor.id &&
    candidate.centerX >= leftLimit &&
    candidate.centerX <= rightLimit &&
    candidate.centerY >= topLimit &&
    candidate.centerY <= bottomLimit
  );
}

function scoreSpatialDistance(
  anchor: PositionedLine,
  candidate: PositionedLine,
  dimensions: { width: number; height: number },
) {
  const dx = Math.max(0, candidate.boundingBox.x - anchor.right) / dimensions.width;
  const dy = Math.abs(candidate.centerY - anchor.centerY) / dimensions.height;
  return Math.max(0, 82 - dx * 55 - dy * 130);
}

function normalizeCandidateValue(key: OcrFieldKey, rawValue: string) {
  const value = cleanValue(rawValue);
  switch (key) {
    case 'recipientTel':
    case 'orderingVendorTel':
    case 'fulfillingVendorTel':
      return normalizePhone(value);
    case 'deliveryDate':
      return normalizeDate(value);
    case 'eventTime':
    case 'strictTime':
      return normalizeTime(value);
    case 'productQuantity':
      return normalizeQuantity(value);
    case 'deliveryAddress':
      if (ADDRESS_EXCLUDE_HINT.test(value)) return '';
      return looksLikeAddress(value) ? value.replace(/^주소\s*[|:]?\s*/u, '') : '';
    case 'productName':
      return PRODUCT_HINT.test(value) ? value : '';
    default:
      return value;
  }
}

function fieldSpecificBonus(key: OcrFieldKey, value: string) {
  if (!value) return -100;
  switch (key) {
    case 'deliveryAddress':
      return looksLikeAddress(value) ? 16 : -28;
    case 'productName':
      return PRODUCT_HINT.test(value) ? 14 : -18;
    case 'deliveryDate':
      return /\d{4}-\d{2}-\d{2}/.test(value) ? 18 : -30;
    case 'eventTime':
    case 'strictTime':
      return /\d{2}:\d{2}/.test(value) ? 12 : -12;
    case 'recipientTel':
    case 'orderingVendorTel':
    case 'fulfillingVendorTel':
      return /\d{2,3}-\d{3,4}-\d{4}/.test(value) ? 18 : -30;
    case 'productQuantity':
      return /^\d{1,2}$/.test(value) ? 10 : -20;
    default:
      return 0;
  }
}

function addressCandidateScore(line: PositionedLine) {
  let score = 0;
  if (looksLikeAddress(line.text)) score += 80;
  if (/(?:병원|장례식장|웨딩|호텔|예식장|홀|호실|층|로\s*\d|길\s*\d)/u.test(line.text)) {
    score += 30;
  }
  if (ADDRESS_EXCLUDE_HINT.test(line.text)) score -= 80;
  return score;
}

function buildCandidate(
  key: OcrFieldKey,
  anchor: PositionedLine,
  sourceLines: PositionedLine[],
  dimensions: { width: number; height: number },
): SpatialFieldCandidate | undefined {
  const rawValue = sourceLines.map((line) => line.text).join(' ');
  const value = normalizeCandidateValue(key, rawValue);
  if (!value) return undefined;
  const averageDistanceScore =
    sourceLines.reduce(
      (sum, line) => sum + scoreSpatialDistance(anchor, line, dimensions),
      0,
    ) / Math.max(sourceLines.length, 1);
  const averageConfidence =
    sourceLines.reduce((sum, line) => sum + (line.confidence ?? 70), 0) /
    Math.max(sourceLines.length, 1);
  const confidence = Math.round(
    Math.max(
      55,
      Math.min(84, averageDistanceScore * 0.72 + averageConfidence * 0.18 + fieldSpecificBonus(key, value)),
    ),
  );
  return {
    key,
    value,
    rawValue,
    confidence,
    sourceText: `${anchor.text} → ${rawValue}`,
    sourceLineIds: [anchor.id, ...sourceLines.map((line) => line.id)],
    anchorText: anchor.text,
    extractionMethod: 'layout',
  };
}

function candidateLinesForAnchor(
  key: OcrFieldKey,
  anchor: PositionedLine,
  lines: PositionedLine[],
  dimensions: { width: number; height: number },
  constants: SpatialHeuristicConstants,
) {
  const candidates = lines
    .filter((line) => candidateWindow(anchor, line, dimensions, constants))
    .filter((line) => !isLikelyLabelOnly(line.text))
    .sort((left, right) => {
      const leftScore = scoreSpatialDistance(anchor, left, dimensions);
      const rightScore = scoreSpatialDistance(anchor, right, dimensions);
      return rightScore - leftScore || left.boundingBox.x - right.boundingBox.x;
    });

  if (key === 'deliveryAddress') {
    return candidates
      .filter((line) => addressCandidateScore(line) > 0)
      .sort((left, right) => addressCandidateScore(right) - addressCandidateScore(left))
      .slice(0, constants.maxCandidatesPerAnchor);
  }
  if (key === 'productName') {
    return candidates
      .filter((line) => PRODUCT_HINT.test(line.text))
      .slice(0, constants.maxCandidatesPerAnchor);
  }
  if (key === 'deliveryDate') {
    return candidates
      .filter((line) => /(?:20\d{2}|월|일|배송|예식|시|분|:)/u.test(line.text))
      .slice(0, constants.maxCandidatesPerAnchor);
  }
  if (key === 'productQuantity') {
    return candidates
      .filter((line) => /(?:수량|^\d{1,2}$|[|:]\s*\d{1,2})/u.test(line.text))
      .slice(0, constants.maxCandidatesPerAnchor);
  }
  if (key === 'recipientTel') {
    return candidates
      .filter((line) => PHONE_PATTERN.test(fixConfusableDigits(line.text)))
      .slice(0, constants.maxCandidatesPerAnchor);
  }
  return candidates.slice(0, constants.maxCandidatesPerAnchor);
}

function inlineCandidateForAnchor(
  key: OcrFieldKey,
  anchor: PositionedLine,
): SpatialFieldCandidate | undefined {
  const rawValue = stripInlineLabel(anchor.text, key);
  if (!rawValue || rawValue === cleanValue(anchor.text)) return undefined;
  const value = normalizeCandidateValue(key, rawValue);
  if (!value) return undefined;
  return {
    key,
    value,
    rawValue,
    confidence: 76,
    sourceText: anchor.text,
    sourceLineIds: [anchor.id],
    anchorText: anchor.text,
    extractionMethod: 'layout',
  };
}

export function extractSpatialFieldCandidates(
  lines: SpatialOcrLine[],
  imageSize: { width?: number; height?: number } = {},
  constants: SpatialHeuristicConstants = DEFAULT_SPATIAL_HEURISTIC_CONSTANTS,
) {
  const positioned = positionedLines(lines);
  const dimensions = inferDimensions(positioned, imageSize.width, imageSize.height);
  const candidates: Partial<Record<OcrFieldKey, SpatialFieldCandidate[]>> = {};
  const keys = Object.keys(ANCHOR_ALIASES) as OcrFieldKey[];

  for (const key of keys) {
    const anchors = positioned.filter((line) => hasAnchor(line.text, key));
    for (const anchor of anchors) {
      const inlineCandidate = inlineCandidateForAnchor(key, anchor);
      if (inlineCandidate) {
        candidates[key] = [...(candidates[key] || []), inlineCandidate];
      }
      const nearby = candidateLinesForAnchor(key, anchor, positioned, dimensions, constants);
      for (let size = Math.min(nearby.length, constants.maxCandidatesPerAnchor); size >= 1; size -= 1) {
        const candidate = buildCandidate(key, anchor, nearby.slice(0, size), dimensions);
        if (candidate) {
          candidates[key] = [...(candidates[key] || []), candidate];
        }
      }
    }
    candidates[key] = (candidates[key] || [])
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 4);
  }

  return candidates;
}

export function inspectSpatialFieldSearch(
  lines: SpatialOcrLine[],
  imageSize: { width?: number; height?: number } = {},
  constants: SpatialHeuristicConstants = DEFAULT_SPATIAL_HEURISTIC_CONSTANTS,
) {
  const positioned = positionedLines(lines);
  const dimensions = inferDimensions(positioned, imageSize.width, imageSize.height);
  const keys = Object.keys(ANCHOR_ALIASES) as OcrFieldKey[];
  return Object.fromEntries(
    keys.map((key) => [
      key,
      positioned
        .filter((line) => hasAnchor(line.text, key))
        .map((anchor) => ({
          anchor: anchor.text,
          nearby: positioned
            .filter((line) => candidateWindow(anchor, line, dimensions, constants))
            .map((line) => ({
              text: line.text,
              labelOnly: isLikelyLabelOnly(line.text),
              addressScore:
                key === 'deliveryAddress' ? addressCandidateScore(line) : undefined,
              normalized:
                key === 'deliveryAddress'
                  ? normalizeCandidateValue(key, line.text)
                  : undefined,
            })),
        })),
    ]),
  );
}

function makeField(candidate: SpatialFieldCandidate): OcrFieldResult {
  return {
    key: candidate.key,
    label: FIELD_LABELS[candidate.key],
    value: candidate.value,
    rawValue: candidate.rawValue,
    confidence: candidate.confidence,
    required: REQUIRED.has(candidate.key),
    sourceText: candidate.sourceText,
    sourceLineIds: candidate.sourceLineIds,
    extractionMethod: 'layout',
    alternatives: [],
    status: candidate.confidence >= 82 ? 'confirmed' : 'review',
  };
}

function shouldReplace(existing: OcrFieldResult, candidate: SpatialFieldCandidate) {
  if (!candidate.value.trim()) return false;
  if (!existing.value.trim()) return true;
  if (existing.status === 'missing') return true;
  if (existing.status === 'warning') {
    return (
      candidate.confidence >= existing.confidence - 8 ||
      candidate.value.length > existing.value.length + 3
    );
  }
  return false;
}

export function applySpatialOcrFieldHeuristics(
  result: OcrPipelineResult,
  lines: SpatialOcrLine[] = [],
  imageSize: { width?: number; height?: number } = {},
  constants: SpatialHeuristicConstants = DEFAULT_SPATIAL_HEURISTIC_CONSTANTS,
): OcrPipelineResult {
  if (!lines.length) return result;
  const candidatesByKey = extractSpatialFieldCandidates(lines, imageSize, constants);
  const nextFields = result.fields.map((current) => {
    const candidates = candidatesByKey[current.key] || [];
    const best = candidates[0];
    if (!best) return current;
    const alternatives = [
      ...new Set([
        ...current.alternatives,
        ...candidates.map((candidate) => candidate.value).filter(Boolean),
      ]),
    ].filter((value) => value !== current.value);
    if (!shouldReplace(current, best)) {
      return {
        ...current,
        alternatives,
      };
    }
    return {
      ...makeField(best),
      alternatives,
    };
  });
  const guardedFields = applyOfficialOcrFieldGuardrails(nextFields);
  const requiredFields = guardedFields.filter((item) => item.required);
  const documentConfidence = Math.round(
    requiredFields.reduce((sum, item) => sum + item.confidence, 0) /
      Math.max(requiredFields.length, 1),
  );
  return {
    ...result,
    fields: guardedFields,
    documentConfidence,
  };
}
