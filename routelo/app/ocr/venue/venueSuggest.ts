// 배송지/상호명에 장소 후보를 '비파괴'로 덧붙인다. 사전에 매칭이 있을 때만
// 후보를 제시하고, 매칭이 없으면 OCR 인식값을 그대로 둔다(미지의 배송지는
// 100% OCR에 맡김). 자동 확정 없음 — 사용자가 후보를 탭했을 때만 값이 바뀐다.

import {
  MatchOptions,
  matchVenue,
  VenueEntry,
  VenueMatch,
  VenueType,
} from './venueGazetteer';

export type FieldLike = {
  key: string;
  value: string;
  status?: string;
  alternatives?: string[];
};

export type VenueSuggestion = {
  fieldKey: string;
  query: string;
  candidates: VenueMatch[]; // 점수순 상위 N (다중 — 오병합 방지)
};

// 배송지/상호명에 장소를 붙일 수 있는 필드 키.
const VENUE_FIELD_KEYS = new Set(['deliveryAddress', 'venueName']);

// 상품명 등으로 장례/예식 종류를 약하게 추정(있으면 후보를 그 종류로 좁힘).
export function inferVenueType(fields: FieldLike[]): VenueType | undefined {
  const text = fields.map((f) => f.value || '').join(' ');
  if (/근조|조화|장례|빈소|발인|삼가|故|고인|상주/.test(text)) return 'funeral';
  if (/축하|결혼|화혼|웨딩|예식|신랑|신부|혼주|축화|본식/.test(text)) return 'wedding';
  return undefined;
}

// band: 최고점과의 점수 차가 이보다 크면 후보에서 제외(결과 랭킹 필터 — 텍스트
// 정규화가 아님). generic 접미사만 겹치는 다른 병원 등은 최고점보다 낮아 잘리고,
// 진짜 동명 지점(청기와 송림/계양)은 점수가 비슷해 함께 남는다.
export function suggestVenues(
  query: string,
  entries: VenueEntry[],
  options: MatchOptions & { type?: VenueType; band?: number } = {},
): VenueMatch[] {
  const limit = options.limit ?? 3;
  const band = options.band ?? 0.1;
  // 종류 힌트가 있으면 그 종류로만 찾는다. 힌트가 있는데 같은 종류에 매칭이 없으면
  // 교차 종류로 넓히지 않는다(장례 배송지에 웨딩홀이 뜨는 오탐 방지). 힌트가 없을
  // 때(type undefined)만 전체를 검색.
  const matches = matchVenue(query, entries, { ...options, limit: limit + 4 });
  if (!matches.length) return [];
  const top = matches[0].score;
  return matches.filter((m) => top - m.score <= band).slice(0, limit);
}

// fields 배열을 받아 배송지/상호명 필드에 대한 후보 목록을 반환한다.
export function collectVenueSuggestions(
  fields: FieldLike[],
  entries: VenueEntry[],
  options: MatchOptions = {},
): VenueSuggestion[] {
  const type = inferVenueType(fields);
  const out: VenueSuggestion[] = [];
  for (const field of fields) {
    if (!VENUE_FIELD_KEYS.has(field.key)) continue;
    const query = (field.value || '').trim();
    if (!query) continue;
    const candidates = suggestVenues(query, entries, { ...options, type });
    // 매칭 없음 → 후보 미생성(OCR 값 그대로 유지, 무근거 주입 방지).
    if (candidates.length) out.push({ fieldKey: field.key, query, candidates });
  }
  return out;
}
