import { FieldDef } from './fieldRegistry';
import { NormalizeResult, ReceiptFieldKey } from './schema';

// 추론(ML) 없이 순수 문자열 휴리스틱만으로 라벨을 정규 필드에 매핑한다.
// 단계: 정규화 → 별칭 정확매칭 → 부분일치 → 편집거리 → 실패 시 unmapped 보존.

const STRIP_JOSA = ['으로', '로', '는', '은', '이', '가', '을', '를', '의', '에'];

// 라벨 비교용 정규화: 공백/구두점 제거, 끝의 조사 제거, 소문자화.
export function normalizeLabel(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/[\s:：·．.\-_/\\[\]()<>{}#*]/g, ''); // 구분/장식 문자 제거
  for (const josa of STRIP_JOSA) {
    if (s.length > josa.length + 1 && s.endsWith(josa)) {
      s = s.slice(0, -josa.length);
      break;
    }
  }
  return s;
}

// 표준 Levenshtein 편집거리.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// 0~1 유사도 (1 = 동일).
function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

const FUZZY_THRESHOLD = 0.6; // 이 미만의 유사도면 후보로도 보지 않음
// 콜론 없는 줄을 "라벨 값"으로 쪼갤 때 쓰는 확신 임계값.
// 값이 라벨에 섞여 들어가는 오분리를 막기 위해 높게 둔다(사실상 정확/근접매칭).
const STRONG_THRESHOLD = 0.8;

// 본부/본사/고객센터 등 화원사 '헤더(HQ) 연락처'는 배송 대상 정보가 아니다.
// "본부전화", "본부팩스"의 '전화'/'팩스' 부분일치로 recipientTel 등에 오매핑되는
// 것을 원천 차단한다(#127). 정규화 라벨(공백·구두점 제거) 기준으로 검사한다.
const HEADER_CONTACT_NOISE = /(본부|본사|지사|고객센터|콜센터|대표전화|대표팩스|대표번호)/;

export type MatchResult = { key: ReceiptFieldKey; score: number } | null;

// 라벨 하나를 가장 잘 맞는 정규 필드에 매핑. 임계값 미만이면 null.
export function matchField(label: string, registry: FieldDef[]): MatchResult {
  const target = normalizeLabel(label);
  if (!target) return null;
  // 헤더(본부/본사/고객센터) 연락처는 어떤 배송 필드에도 매핑하지 않는다(#127).
  if (HEADER_CONTACT_NOISE.test(target)) return null;

  let best: MatchResult = null;
  const consider = (key: ReceiptFieldKey, score: number) => {
    if (!best || score > best.score) best = { key, score };
  };

  for (const def of registry) {
    // label 자신도 별칭에 포함시켜 비교
    const aliases = [def.label, ...def.aliases];
    for (const alias of aliases) {
      const norm = normalizeLabel(alias);
      if (!norm) continue;
      if (norm === target) {
        consider(def.key, 1); // 정확매칭은 최고점
        continue;
      }
      // 부분일치: 짧은 쪽이 긴 쪽에 포함 (최소 길이 2 가드)
      if (target.length >= 2 && norm.length >= 2 && (norm.includes(target) || target.includes(norm))) {
        const ratio = Math.min(norm.length, target.length) / Math.max(norm.length, target.length);
        consider(def.key, 0.85 * ratio); // 부분일치는 정확매칭보다 낮게
        continue;
      }
      // 퍼지: 편집거리 유사도
      const sim = similarity(target, norm);
      if (sim >= FUZZY_THRESHOLD) consider(def.key, 0.6 * sim);
    }
  }

  return best;
}

export type ParsedLine = {
  field: MatchResult; // 매칭된 정규 필드(없으면 null)
  label: string; // 인식한 라벨(없으면 '')
  value: string; // 값
};

// 한 줄을 라벨/값으로 분해한다. 콜론 분리와 토큰 분리를 라벨 인식 기반으로 처리.
export function parseLine(line: string, registry: FieldDef[]): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 1) 콜론 분리: 단, 콜론 앞에 숫자가 있으면 그 콜론은 값(예: 시간 11:00)의 일부로 본다.
  const colonIdx = trimmed.search(/[:：]/);
  if (colonIdx > 0) {
    const before = trimmed.slice(0, colonIdx);
    if (!/[0-9]/.test(before)) {
      const label = before.trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      // 콜론 앞은 라벨일 확률이 매우 높으므로 약한 매칭(퍼지/오타)도 수용한다.
      const matched = matchField(label, registry);
      return { field: matched, label, value };
    }
  }

  // 2) 토큰 분리: 가장 긴 선두 라벨을 강한 임계값으로 찾는다("발주 전화" 같은 공백 라벨 대응).
  const tokens = trimmed.split(/\s+/);
  for (let k = tokens.length; k >= 1; k -= 1) {
    const label = tokens.slice(0, k).join(' ');
    const value = tokens.slice(k).join(' ');
    const matched = matchField(label, registry);
    if (matched && matched.score >= STRONG_THRESHOLD) {
      return { field: matched, label, value };
    }
  }

  // 3) 어떤 라벨에도 안 붙음 → 줄 전체가 값/고아 텍스트
  return { field: null, label: '', value: trimmed };
}

// 같은 필드가 또 들어오면 첫 값을 유지하고 추가분은 unmapped로 보존(손실 방지).
function assign(
  result: NormalizeResult,
  key: ReceiptFieldKey,
  value: string,
  originalLabel: string,
) {
  if (result.fields[key] === undefined || result.fields[key] === '') {
    result.fields[key] = value;
  } else {
    result.unmapped.push({ label: originalLabel, value });
  }
}

// OCR 라인 배열 → { fields, unmapped }.
// "라벨: 값" 동일 줄과 "라벨\n값" 분리 줄 레이아웃을 모두 처리한다.
export function normalizeReceipt(lines: string[], registry: FieldDef[]): NormalizeResult {
  const result: NormalizeResult = { fields: {}, unmapped: [] };
  let pending: { key: ReceiptFieldKey; label: string } | null = null;

  for (const rawLine of lines) {
    const parsed = parseLine(rawLine, registry);
    if (!parsed) continue;

    if (parsed.field) {
      // 알려진 필드를 인식
      if (parsed.value) {
        assign(result, parsed.field.key, parsed.value, parsed.label);
        pending = null;
      } else {
        // "라벨:" 만 있고 값은 다음 줄 → 보류
        pending = { key: parsed.field.key, label: parsed.label };
      }
    } else if (parsed.label === '') {
      // 라벨 없는 순수 값/고아 텍스트
      if (pending) {
        assign(result, pending.key, parsed.value, pending.label);
        pending = null;
      } else {
        result.unmapped.push({ label: '', value: parsed.value });
      }
    } else {
      // 콜론은 있으나 어느 필드에도 매칭 안 됨 → 라벨/값 그대로 보존
      result.unmapped.push({ label: parsed.label, value: parsed.value });
      pending = null;
    }
  }

  return result;
}
