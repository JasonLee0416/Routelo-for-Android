import {
  METRO_VENUES,
  suggestDeliveryVenues,
  suggestVenuesForAddress,
} from '..';
import { inferVenueType } from '../venueSuggest';

describe('수도권 장소 가제티어 — 배송지 후보 제안', () => {
  it('번들 데이터가 768곳을 담는다', () => {
    expect(METRO_VENUES.length).toBe(768);
    for (const v of METRO_VENUES.slice(0, 20)) {
      expect(typeof v.name).toBe('string');
      expect(['funeral', 'wedding']).toContain(v.type);
    }
  });

  it('사전에 있는 배송지는 정규 장소명 후보를 제시한다(서울/경기/인천)', () => {
    expect(
      suggestVenuesForAddress('서울 동작구 중앙대병원 장례식장 5호', 'funeral')[0]?.entry
        .name,
    ).toContain('중앙대학교병원');
    expect(
      suggestVenuesForAddress('경기 수원시 아주대학교병원 장례식장 3층', 'funeral')[0]
        ?.entry.name,
    ).toContain('아주대학교병원');
    expect(
      suggestVenuesForAddress('인천 남동구 가천대길병원 장례식장', 'funeral')[0]?.entry
        .name,
    ).toContain('가천대길병원');
  });

  it('사전에 없는 배송지는 후보를 만들지 않는다(OCR 값 그대로 — 폴백)', () => {
    const fields = [
      { key: 'productName', value: '근조3단' },
      { key: 'deliveryAddress', value: '서울 강남구 무명의어떤장소 12-3', status: 'review' },
    ];
    const suggestions = suggestDeliveryVenues(fields);
    expect(suggestions.find((s) => s.fieldKey === 'deliveryAddress')).toBeUndefined();
  });

  it('후보 제안은 비파괴 — 원본 필드 value/status를 바꾸지 않는다', () => {
    const fields = [
      { key: 'productName', value: '근조3단' },
      {
        key: 'deliveryAddress',
        value: '서울 동작구 중앙대병원 장례식장 5호',
        status: 'review',
        alternatives: [],
      },
    ];
    const snapshot = JSON.stringify(fields);
    suggestDeliveryVenues(fields);
    // 입력 배열/필드는 불변(후보는 별도 구조로 반환).
    expect(JSON.stringify(fields)).toBe(snapshot);
  });

  it('이름이 비슷한 다른 업체는 후보를 여러 개 제시(오병합 방지)', () => {
    const cands = suggestVenuesForAddress('청기와장례식장', 'funeral');
    const names = cands.map((c) => c.entry.name);
    // 인천 송림점·계양점이 함께 후보로.
    expect(names.filter((n) => n.includes('청기와')).length).toBeGreaterThanOrEqual(2);
  });

  it('상품명으로 장례/예식 종류를 추정한다', () => {
    expect(inferVenueType([{ key: 'productName', value: '근조3단' }])).toBe('funeral');
    expect(inferVenueType([{ key: 'productName', value: '축하 3단 화환' }])).toBe('wedding');
  });
});
