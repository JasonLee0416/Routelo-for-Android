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

export type { FieldLike, VenueSuggestion } from './venueSuggest';
export type { VenueEntry, VenueMatch, VenueType } from './venueGazetteer';
