import { matchVenue, normalizeVenue, venueSimilarity, VenueEntry } from './venueGazetteer';

// 골든 인수증에 등장한 장소들의 최소 사전(실제 데이터는 data/*.json 수집 후 대체).
const FIXTURE: VenueEntry[] = [
  {
    name: '고려대학교구로병원 장례식장',
    aliases: ['고대구로병원 장례식장', '고려대 구로병원 장례식장', '구로병원 장례식장'],
    district: '구로구',
    type: 'funeral',
  },
  {
    name: '중앙대학교병원 장례식장',
    aliases: ['중앙대병원 장례식장', '중대병원 장례식장'],
    district: '동작구',
    type: 'funeral',
  },
  {
    name: '서울보라매병원 장례식장',
    aliases: ['보라매병원 장례식장', '보라매병원'],
    district: '동작구',
    type: 'funeral',
  },
  {
    name: '공군회관',
    aliases: ['공군호텔', '공군회관 웨딩'],
    district: '영등포구',
    type: 'wedding',
  },
];

describe('venue gazetteer matcher', () => {
  it('정규화는 공백·구두점만 제거한다(적극 정규화 안 함 — 누락 방지)', () => {
    expect(normalizeVenue('고대구로병원 장례식장')).toBe('고대구로병원장례식장');
    expect(normalizeVenue('더채플앳 청담')).toBe('더채플앳청담');
    // 호실/층·일반 홀명은 제거하지 않는다.
    expect(normalizeVenue('공군호텔 웨딩홀')).toBe('공군호텔웨딩홀');
  });

  it('OCR 배송지에서 정규 장례식장을 후보로 찾는다', () => {
    const m = matchVenue('고대구로병원 장례식장 105호실', FIXTURE);
    expect(m[0]?.entry.name).toBe('고려대학교구로병원 장례식장');
    expect(m[0]?.score).toBeGreaterThanOrEqual(0.9);
  });

  it('철자가 조금 다른 표기도 매칭한다(고려대 구로병원)', () => {
    const m = matchVenue('서울 구로구 고려대 구로병원 장례식장 105호', FIXTURE);
    expect(m[0]?.entry.name).toBe('고려대학교구로병원 장례식장');
  });

  it('중앙대병원 장례식장 5호 → 중앙대학교병원', () => {
    const m = matchVenue('서울 동작구 중앙대병원 장례식장 5호', FIXTURE, { type: 'funeral' });
    expect(m[0]?.entry.name).toBe('중앙대학교병원 장례식장');
  });

  it('보라매병원 1호 → 보라매병원 장례식장', () => {
    const m = matchVenue('서울 보라매병원 1호', FIXTURE);
    expect(m[0]?.entry.name).toBe('서울보라매병원 장례식장');
  });

  it('공군호텔 그랜드볼룸 → 공군회관(웨딩)', () => {
    const m = matchVenue('서울 영등포구 공군호텔 그랜드볼룸 3층', FIXTURE);
    expect(m[0]?.entry.name).toBe('공군회관');
  });

  it('무관한 텍스트는 매칭하지 않는다(오탐 방지)', () => {
    expect(matchVenue('서울역 광장', FIXTURE)).toHaveLength(0);
    expect(matchVenue('스타벅스 강남점', FIXTURE)).toHaveLength(0);
  });

  it('1~2글자 우연 일치는 배제한다', () => {
    // "병원"만 겹치는 2글자 → 최소 LCS(3) 가드로 후보 아님
    expect(venueSimilarity(normalizeVenue('병원'), normalizeVenue('보라매병원장례식장'))).toBe(0);
  });
});
