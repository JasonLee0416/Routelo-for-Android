// 수도권 장소 가제티어(서울+경기+인천, 768곳) — 앱 번들 데이터 + 후보 제안 API.
// 검토 화면에서 배송지/상호명에 정규 장소명 후보를 제시하는 데 쓴다.
// 매칭이 없으면 후보를 만들지 않으므로 OCR 인식값이 그대로 유지된다.

import metroVenuesData from './metro-venues.json';
import { VenueEntry } from './venueGazetteer';
import {
  collectVenueSuggestions,
  FieldLike,
  suggestVenues,
  VenueSuggestion,
} from './venueSuggest';

export const METRO_VENUES = metroVenuesData as VenueEntry[];

// 검토 화면용: 필드 배열(배송지/상호명 포함)에 대한 장소 후보 목록.
// 후보가 있는 필드만 반환(없으면 OCR 값 유지 — 무근거 주입 없음).
export function suggestDeliveryVenues(fields: FieldLike[]): VenueSuggestion[] {
  return collectVenueSuggestions(fields, METRO_VENUES);
}

// 단일 주소 문자열에 대한 상위 후보(수동 조회용).
export function suggestVenuesForAddress(address: string, type?: 'funeral' | 'wedding') {
  return suggestVenues(address, METRO_VENUES, type ? { type } : {});
}

// 배송지에서 호실/층 같은 '위치 세부 꼬리'를 뽑는다(예: "…중앙대병원 장례식장
// 5호" → "5호", "…105호실" → "105호실", "…그랜드볼룸 3층" → "3층").
// 마지막 매칭을 취해 장소명 뒤에 붙은 실제 위치를 잡는다.
export function extractUnitSuffix(text: string): string {
  // \b(ASCII 경계)는 한글 뒤에서 동작하지 않으므로 쓰지 않는다. 숫자 뒤에
  // 호실/호/층/실이 와야 매칭되므로 도로 번지(호/층 없는 숫자)는 잡히지 않는다.
  const matches = (text || '').match(/(?:지하\s*)?\d+\s*(?:호실|호|층|실)/g);
  return matches ? matches[matches.length - 1].replace(/\s+/g, '') : '';
}

// 장소 후보를 탭했을 때 넣을 값. 정규 장소명에 원본 배송지의 호실/층을 이어붙여
// 세부 위치를 잃지 않는다. 세부가 없으면 정규명만.
export function composeVenueValue(canonicalName: string, ocrValue: string): string {
  const suffix = extractUnitSuffix(ocrValue);
  return suffix ? `${canonicalName} ${suffix}` : canonicalName;
}

export type { FieldLike, VenueSuggestion } from './venueSuggest';
export type { VenueEntry, VenueMatch, VenueType } from './venueGazetteer';
