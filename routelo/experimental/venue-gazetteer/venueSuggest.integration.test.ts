/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

import { parseReceiptText } from '../../app/services/ocr';
import { VenueEntry } from './venueGazetteer';
import {
  attachVenueCandidates,
  collectVenueSuggestions,
  inferVenueType,
  suggestVenues,
} from './venueSuggest';

// 통합 사전(서울+경기+인천) 로드.
const loadAll = (): VenueEntry[] => {
  const dir = path.join(__dirname, 'data');
  const files = [
    'seoul-funeral.json', 'seoul-wedding.json',
    'gyeonggi-funeral.json', 'gyeonggi-wedding.json',
    'incheon-funeral.json', 'incheon-wedding.json',
  ];
  return files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
};
const GAZ = loadAll();

const quality = {
  score: 90, blur: 90, brightness: 90, documentCoverage: 90,
  skew: 90, shadow: 90, passed: true, messages: [],
} as never;

describe('venue candidate injection — pipeline 연동 (review only)', () => {
  it('통합 사전 규모 확인(수도권 768곳)', () => {
    expect(GAZ.length).toBe(768);
  });

  it('parseReceiptText 출력의 배송지에 장소 후보를 붙인다(값/상태 불변)', () => {
    // 실제 파이프라인: OCR 텍스트 → parseReceiptText → 후보 주입.
    const text = [
      '발주처: 아뜰리에몽플라워',
      '품명: 근조3단',
      '배달일시: 2026년 06월 14일',
      '배달장소: 서울 동작구 중앙대병원 장례식장 5호',
    ].join('\n');
    const parsed = parseReceiptText(text, quality);
    const before = parsed.fields.find((f) => f.key === 'deliveryAddress')!;

    const { fields, suggestions } = attachVenueCandidates(parsed.fields, GAZ);
    const after = fields.find((f) => f.key === 'deliveryAddress')!;
    const sug = suggestions.find((s) => s.fieldKey === 'deliveryAddress')!;

    console.log(
      `배송지 "${sug.query}" 후보:`,
      sug.candidates.map((c) => `${c.entry.name}(${c.score.toFixed(2)})`).join(' / '),
    );

    // 정규 장소명이 후보(alternatives)로 주입됨.
    expect(sug.candidates[0].entry.name).toContain('중앙대학교병원');
    expect(after.alternatives).toContain('중앙대학교병원 장례식장');
    // zero-fabrication: 값·상태 불변.
    expect(after.value).toBe(before.value);
    expect(after.status).toBe(before.status);
  });

  it('종류 힌트(근조→장례식장)로 후보를 좁힌다', () => {
    const funeral = inferVenueType([{ key: 'productName', value: '근조3단' }]);
    const wedding = inferVenueType([{ key: 'productName', value: '축하 3단 화환' }]);
    expect(funeral).toBe('funeral');
    expect(wedding).toBe('wedding');
  });

  it('이름이 비슷한 서로 다른 업체는 후보를 여러 개 제시(오병합 방지)', () => {
    // "청기와장례식장"은 인천 송림점·계양점 등 별개 지점이 존재 → 둘 다 후보로.
    const cands = suggestVenues('청기와장례식장', GAZ, { type: 'funeral', limit: 5 });
    console.log('청기와 후보:', cands.map((c) => c.entry.name).join(' / '));
    expect(cands.length).toBeGreaterThanOrEqual(2);
    // "제일장례식장"도 경기 여러 시에 동명 별개 시설 → 다중 후보.
    const jeil = suggestVenues('제일장례식장', GAZ, { type: 'funeral', limit: 5 });
    expect(jeil.length).toBeGreaterThanOrEqual(2);
  });

  it('사전에 없는 배송지는 후보를 만들지 않는다(무근거 주입 방지)', () => {
    const parsed = parseReceiptText('배달장소: 서울 강남구 무명의어떤곳 12-3', quality);
    const sug = collectVenueSuggestions(parsed.fields, GAZ);
    const addr = sug.find((s) => s.fieldKey === 'deliveryAddress');
    expect(addr).toBeUndefined();
  });

  it('경기·인천 배송지도 통합 사전에서 매칭', () => {
    expect(
      suggestVenues('경기 수원시 아주대학교병원 장례식장', GAZ, { type: 'funeral' })[0]
        ?.entry.name,
    ).toContain('아주대학교병원');
    expect(
      suggestVenues('인천 남동구 가천대길병원 장례식장', GAZ, { type: 'funeral' })[0]?.entry
        .name,
    ).toContain('가천대길병원');
  });
});
