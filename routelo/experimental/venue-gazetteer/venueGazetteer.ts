// 실험 모듈 — 프로덕션 import 금지(README 참조).
// OCR로 뽑은 배송지/상호명 텍스트를 서울 장례식장·예식장 사전과 대조해
// 정규 장소명을 '후보'로 제시한다. 자동 확정 없음(zero-fabrication).

export type VenueType = 'funeral' | 'wedding';

export type VenueEntry = {
  name: string;
  aliases?: string[];
  district?: string;
  address?: string;
  type?: VenueType;
};

export type VenueMatch = {
  entry: VenueEntry;
  matchedForm: string; // 사전에서 실제로 매칭된 표면형(name 또는 alias)
  score: number; // 0~1
};

// 매칭 정규화: 공백·구두점 제거, 소문자화, 그리고 값 뒤에 흔히 붙는
// 호실/층/번지/동 같은 위치 꼬리를 제거해 '장소명 핵심'만 남긴다.
// 장소를 특정하지 못하는 일반 홀·연회장·예식 종류어. 배송지에는 "장소명 + 이
// 세부명"이 붙는 경우가 많아(예: "공군호텔 그랜드볼룸", "롯데호텔월드 크리스탈볼룸",
// "KU컨벤션웨딩홀"), 매칭 전에 걷어내 장소명 핵심만 남긴다. 단, 장례식장은
// 장례식 배송지 식별에 핵심이라 제거하지 않는다.
const GENERIC_VENUE_TERMS =
  /그랜드볼룸|크리스탈볼룸|다이너스티홀|다이아몬드홀|그랜드홀|로얄볼룸|가든홀|컨벤션홀|볼룸|연회장|w웨딩홀|웨딩홀|예식홀/gi;

export function normalizeVenue(raw: string): string {
  let s = (raw || '').normalize('NFKC').trim().toLowerCase();
  // 위치 꼬리 제거: "105호실", "3층", "201호", "지하1층", "b1" 등
  s = s.replace(/\s*(?:지하|b)?\s*\d+\s*(?:호실|호|층|f)\b/gi, ' ');
  s = s.replace(/\s*\d+\s*(?:호실|호|층)/g, ' ');
  // 일반 홀/연회장/예식 종류어 제거(장례식장은 보존)
  s = s.replace(GENERIC_VENUE_TERMS, ' ');
  // 구두점·공백·괄호 제거
  s = s.replace(/[\s·・.,/\\|()[\]{}<>~\-–—:：'"]+/g, '');
  return s;
}

// 최장 공통 부분문자열 길이(연속).
export function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i += 1) {
    let diagPrev = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = diagPrev + 1;
        if (prev[j] > best) best = prev[j];
      } else {
        prev[j] = 0;
      }
      diagPrev = tmp;
    }
  }
  return best;
}

// 두 정규화 문자열의 유사도(0~1). 1~2글자 우연 일치는 최소 LCS 가드로 배제.
export function venueSimilarity(a: string, b: string, minLcs = 3): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // a=OCR 텍스트, b=사전 표면형으로 가정한 비대칭 포함 관계.
  if (a.length >= minLcs && b.length >= minLcs) {
    // 사전 장소명(b)이 OCR(a)에 통째로 등장 → 강한 신호. 실제 배송지는
    // "장소명 + 세부홀명/층"이 흔해 b가 a의 작은 부분이어도 확신도가 높다.
    // 뒤따르는 세부정보 길이로 감점하지 않고, b가 충분히 구체적이면 높게 준다.
    if (a.includes(b)) return Math.max(0.6, Math.min(1, b.length / 5));
    // OCR(a)이 사전명(b)의 일부만 담은 경우 → 담긴 비율로 점수.
    if (b.includes(a)) return a.length / b.length;
  }
  const lcs = longestCommonSubstring(a, b);
  if (lcs < minLcs) return 0;
  return lcs / Math.min(a.length, b.length);
}

export type MatchOptions = {
  threshold?: number; // 이 값 이상만 후보(기본 0.6)
  limit?: number; // 상위 N(기본 5)
  minLcs?: number; // 최소 공통 부분문자열(기본 3)
  type?: VenueType; // 특정 종류로 제한
};

// OCR 텍스트에 대해 사전에서 가장 잘 맞는 장소 후보들을 점수순으로 반환.
export function matchVenue(
  ocrText: string,
  entries: VenueEntry[],
  options: MatchOptions = {},
): VenueMatch[] {
  const threshold = options.threshold ?? 0.6;
  const limit = options.limit ?? 5;
  const minLcs = options.minLcs ?? 3;
  const normOcr = normalizeVenue(ocrText);
  if (normOcr.length < minLcs) return [];

  const matches: VenueMatch[] = [];
  for (const entry of entries) {
    if (options.type && entry.type && entry.type !== options.type) continue;
    const forms = [entry.name, ...(entry.aliases || [])];
    let best = 0;
    let bestForm = entry.name;
    for (const form of forms) {
      const score = venueSimilarity(normOcr, normalizeVenue(form), minLcs);
      if (score > best) {
        best = score;
        bestForm = form;
      }
    }
    if (best >= threshold) {
      matches.push({ entry, matchedForm: bestForm, score: best });
    }
  }
  matches.sort((l, r) => r.score - l.score);
  return matches.slice(0, limit);
}
