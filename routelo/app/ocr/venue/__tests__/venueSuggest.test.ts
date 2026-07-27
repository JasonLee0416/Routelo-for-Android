import {
  composeVenueValue,
  extractUnitSuffix,
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

  it('동명(시 다른) 별개 시설은 구별 가능한 후보로 나온다', () => {
    // "제일장례식장"은 안산·평택에 별개로 존재 → 둘 다, district로 구별.
    const cands = suggestVenuesForAddress('제일장례식장', 'funeral');
    const jeil = cands.filter((c) => c.entry.name === '제일장례식장');
    expect(jeil.length).toBeGreaterThanOrEqual(2);
    expect(new Set(jeil.map((c) => c.entry.district)).size).toBeGreaterThanOrEqual(2);
  });

  it('오탐 방지: 무관한 빌딩명은 엉뚱한 예식장을 부르지 않는다(minLcs=4)', () => {
    // "신화빌딩" 3글자 겹침("화빌딩")으로 문화웨딩홀이 뜨던 오탐 → 이제 미매칭.
    const cands = suggestVenuesForAddress('부산 해운대구 우동 신화빌딩 3층');
    expect(cands.map((c) => c.entry.name)).not.toContain('문화웨딩홀');
  });

  it('상호명(venueName) 필드도 후보를 받는다', () => {
    const fields = [
      { key: 'productName', value: '축하 3단 화환' },
      { key: 'venueName', value: '더채플앳 청담', status: 'review' },
    ];
    const sug = suggestDeliveryVenues(fields);
    const v = sug.find((s) => s.fieldKey === 'venueName');
    expect(v?.candidates[0]?.entry.name.replace(/\s/g, '')).toContain('더채플앳청담');
  });

  it('호실/층 꼬리를 추출한다', () => {
    expect(extractUnitSuffix('서울 동작구 중앙대병원 장례식장 5호')).toBe('5호');
    expect(extractUnitSuffix('고대구로병원 장례식장 105호실')).toBe('105호실');
    expect(extractUnitSuffix('공군호텔 그랜드볼룸 3층')).toBe('3층');
    expect(extractUnitSuffix('중앙대병원 장례식장')).toBe('');
    // 도로 번지(호/층 없음)는 꼬리로 잡지 않는다.
    expect(extractUnitSuffix('서울 구로구 구로동로 148')).toBe('');
  });

  it('장소 후보 선택 시 정규 장소명 + 호실을 유지한다', () => {
    // 탭 시 값: 정규명에 원본의 호실/층을 이어붙여 세부 위치를 잃지 않는다.
    expect(
      composeVenueValue('중앙대학교병원 장례식장', '서울 동작구 중앙대병원 장례식장 5호'),
    ).toBe('중앙대학교병원 장례식장 5호');
    expect(
      composeVenueValue('고려대학교구로병원 장례식장', '고대구로병원 장례식장 105호실'),
    ).toBe('고려대학교구로병원 장례식장 105호실');
    // 호실이 없으면 정규명만.
    expect(composeVenueValue('신라호텔', '서울 중구 신라호텔')).toBe('신라호텔');
  });
});
