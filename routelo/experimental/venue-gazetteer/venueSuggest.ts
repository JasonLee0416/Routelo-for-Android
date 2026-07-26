// 실험 모듈 — 프로덕션 import 금지(README 참조).
// 통합 가제티어(서울+경기+인천)로 OCR 배송지/상호명에 '장소 후보'를 주입한다.
// 파이프라인 연동 지점: app의 parseReceiptText/runReceiptOcr가 만든 fields를
// 이 후처리에 통과시켜 검토 화면에 후보를 노출한다. 자동확정 없음(review only).
//
// ⚠️ 오병합 방지: 단일 정답을 강제하지 않고 상위 N개 후보를 모두 반환한다.
// 이름 몇 글자 차이의 '다른 업체'가 있으면 둘 다 후보로 떠서 사용자가 고른다.

import { matchVenue, MatchOptions, VenueEntry, VenueMatch, VenueType } from './venueGazetteer';

// app OcrFieldResult의 최소 형태(experimental이 app 타입에 의존하지 않도록 로컬 정의).
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

// 한 배송지 문자열에 대한 장소 후보(상위 N). 종류 힌트가 있으면 우선 그 종류로
// 찾고, 없으면 통합 검색. review-only이므로 여기서 값을 바꾸지 않는다.
// band: 최고점과의 점수 차가 이보다 크면 후보에서 제외한다(결과 랭킹 필터 —
// 텍스트 정규화가 아님). "X병원 장례식장" 질의에 접미사만 겹쳐 붙는 다른 병원
// 같은 generic 충돌은 최고점보다 낮아 잘리고, 진짜 동명 지점(청기와 송림/계양)은
// 점수가 비슷해 함께 남는다 — 오병합 우려에 부합.
export function suggestVenues(
  query: string,
  entries: VenueEntry[],
  options: MatchOptions & { type?: VenueType; band?: number } = {},
): VenueMatch[] {
  const limit = options.limit ?? 3;
  const band = options.band ?? 0.1;
  const run = (opts: MatchOptions) =>
    matchVenue(query, entries, { ...opts, limit: (opts.limit ?? limit) + 4 });
  let matches = run(options);
  if (!matches.length && options.type) matches = run({ ...options, type: undefined });
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
    if (candidates.length) out.push({ fieldKey: field.key, query, candidates });
  }
  return out;
}

// review-only 주입: 후보의 정규 명칭을 field.alternatives에 추가만 한다.
// value/status는 절대 바꾸지 않는다(zero-fabrication). 원본 배열은 불변,
// 얕은 복사본을 돌려준다.
export function attachVenueCandidates<T extends FieldLike>(
  fields: T[],
  entries: VenueEntry[],
  options: MatchOptions = {},
): { fields: T[]; suggestions: VenueSuggestion[] } {
  const suggestions = collectVenueSuggestions(fields, entries, options);
  const byKey = new Map(suggestions.map((s) => [s.fieldKey, s]));
  const nextFields = fields.map((field) => {
    const sug = byKey.get(field.key);
    if (!sug) return field;
    const names = sug.candidates.map((c) => c.entry.name);
    const alternatives = [...new Set([...(field.alternatives || []), ...names])];
    // value/status 불변 — 후보만 덧붙인다.
    return { ...field, alternatives };
  });
  return { fields: nextFields, suggestions };
}
