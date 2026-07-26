/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { matchVenue, VenueEntry } from './venueGazetteer';

const funeral: VenueEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/seoul-funeral.json'), 'utf8'),
);
const wedding: VenueEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/seoul-wedding.json'), 'utf8'),
);
const all = [...funeral, ...wedding];

// 골든 인수증의 실제 배송지 원문 → 기대 정규 장소명(부분)
const GOLDEN = [
  { ocr: '서울 동작구 중앙대병원 장례식장 5호', expect: '중앙대학교병원' },
  { ocr: '서울 영등포구 선유로 101 교원예움 서서울 장례식장 201호', expect: '교원예움' },
  { ocr: '고대구로병원 장례식장 105호실', expect: '고려대학교구로병원' },
  { ocr: '서울 구로구 고려대 구로병원 장례식장 105호', expect: '고려대학교구로병원' },
  { ocr: '서울 보라매병원 1호', expect: '보라매병원' },
];

describe('seoul-funeral gazetteer (real data)', () => {
  it('JSON이 유효하고 필수 필드를 가진다(병합 후 60+곳)', () => {
    expect(funeral.length).toBeGreaterThanOrEqual(60);
    for (const v of funeral) {
      expect(typeof v.name).toBe('string');
      expect(Array.isArray(v.aliases)).toBe(true);
      expect(v.type).toBe('funeral');
    }
  });

  it('골든 배송지들이 올바른 장례식장으로 매칭된다', () => {
    for (const g of GOLDEN) {
      const m = matchVenue(g.ocr, funeral, { type: 'funeral' });
      const top = m[0];
      console.log(
        `${g.ocr.slice(0, 30).padEnd(32)} → ${top ? `${top.entry.name} (${top.score.toFixed(2)})` : '없음'}`,
      );
      expect((top?.entry.name || '').replace(/\s/g, '')).toContain(
        g.expect.replace(/\s/g, ''),
      );
    }
  });

  it('무관한 배송지는 매칭하지 않는다', () => {
    expect(matchVenue('서울 강남구 테헤란로 스타벅스', funeral)).toHaveLength(0);
  });
});

describe('seoul-wedding gazetteer (real data)', () => {
  it('JSON이 유효하고 wedding 타입 필수 필드를 가진다', () => {
    expect(wedding.length).toBeGreaterThanOrEqual(200);
    for (const v of wedding) {
      expect(typeof v.name).toBe('string');
      expect(Array.isArray(v.aliases)).toBe(true);
      expect(v.type).toBe('wedding');
    }
  });

  const WED = [
    { ocr: '서울 강남구 선릉로 757 더채플앳청담 3층', expect: '더채플앳청담' },
    { ocr: '서울 영등포구 국제금융로 10 콘래드 서울 그랜드볼룸', expect: '콘래드 서울' },
    { ocr: '잠실 롯데호텔월드 크리스탈볼룸', expect: '롯데호텔월드' },
    { ocr: '서울 중구 장충 신라호텔 다이너스티홀', expect: '신라호텔' },
  ];

  it('예식장 배송지가 올바른 웨딩홀로 매칭된다', () => {
    for (const g of WED) {
      const m = matchVenue(g.ocr, wedding, { type: 'wedding' });
      const top = m[0];
      console.log(
        `${g.ocr.slice(0, 32).padEnd(34)} → ${top ? `${top.entry.name} (${top.score.toFixed(2)})` : '없음'}`,
      );
      expect((top?.entry.name || '').replace(/\s/g, '')).toContain(
        g.expect.replace(/\s/g, ''),
      );
    }
  });

  it('장례식장+예식장 통합 사전에서도 종류를 필터해 정확 매칭', () => {
    // 통합 사전에 던져도 장례식장 질의는 장례식장으로.
    const m = matchVenue('중앙대병원 장례식장 5호', all, { type: 'funeral' });
    expect(m[0]?.entry.name).toContain('중앙대학교병원');
  });
});

const gFuneral: VenueEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/gyeonggi-funeral.json'), 'utf8'),
);
const gWedding: VenueEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/gyeonggi-wedding.json'), 'utf8'),
);

describe('gyeonggi gazetteer (real data)', () => {
  it('JSON이 유효하고 장례식장 183·예식장 182를 가진다', () => {
    expect(gFuneral.length).toBe(183);
    expect(gWedding.length).toBe(182);
    for (const v of [...gFuneral, ...gWedding]) {
      expect(typeof v.name).toBe('string');
      expect(['funeral', 'wedding']).toContain(v.type);
    }
  });

  it('경기 배송지가 올바른 장소로 매칭된다', () => {
    expect(
      matchVenue('경기 수원시 아주대학교병원 장례식장 3층', gFuneral, { type: 'funeral' })[0]
        ?.entry.name,
    ).toContain('아주대학교병원');
    expect(
      matchVenue('용인시 기흥구 시엠프레 기흥점', gWedding, { type: 'wedding' })[0]?.entry
        .name,
    ).toContain('시엠프레');
  });
});

const iFuneral: VenueEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/incheon-funeral.json'), 'utf8'),
);
const iWedding: VenueEntry[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/incheon-wedding.json'), 'utf8'),
);

describe('incheon gazetteer (real data)', () => {
  it('JSON이 유효하고 장례식장 35·예식장 40을 가진다', () => {
    expect(iFuneral.length).toBe(35);
    expect(iWedding.length).toBe(40);
  });

  it('인천 배송지가 올바른 장소로 매칭된다', () => {
    expect(
      matchVenue('인천 남동구 가천대길병원 장례식장 특2호', iFuneral, { type: 'funeral' })[0]
        ?.entry.name,
    ).toContain('가천대길병원');
    // 별칭(길병원장례식장)으로도 매칭
    expect(
      matchVenue('길병원장례식장', iFuneral, { type: 'funeral' })[0]?.entry.name,
    ).toContain('가천대길병원');
  });
});
