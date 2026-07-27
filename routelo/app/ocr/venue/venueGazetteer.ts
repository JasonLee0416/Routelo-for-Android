// 수도권 장소 가제티어 매처(프로덕션). OCR로 뽑은 배송지/상호명을 사전과 대조해
// 정규 장소명을 '후보'로 제시한다. 자동 확정 없음(zero-fabrication) — 값은 검토
// 화면에서 사용자가 후보를 탭했을 때만 반영된다. 순수 함수(런타임 의존 없음).

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

// 매칭 정규화는 공백·구두점·괄호 제거만(대소문자 통일 포함). 일반 홀명·종류어를
// 걷어내는 적극 정규화는 실제 장소명을 훼손해 누락을 유발할 수 있어 하지 않는다.
export function normalizeVenue(raw: string): string {
  return (raw || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s·・.,/\\|()[\]{}<>~\-–—:：'"]+/g, '');
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
