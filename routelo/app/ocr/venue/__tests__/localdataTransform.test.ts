// #150 LOCALDATA 변환기 순수 함수 회귀 테스트.
// 스크립트(.mjs)의 순수 함수를 직접 검증해 CSV 파싱·주소 파싱·필터·태깅을 고정한다.
import {
  districtOf,
  isOperating,
  parseCsv,
  transformRows,
} from '../../../../scripts/localdataTransform.js';

describe('LOCALDATA venue transformer', () => {
  it('parseCsv: 따옴표·콤마·CRLF·이스케이프 따옴표 처리', () => {
    expect(parseCsv('a,b\r\nc,"d,e"\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd,e'],
    ]);
    expect(parseCsv('x,"he said ""hi"""')).toEqual([['x', 'he said "hi"']]);
  });

  it('parseCsv: 선두 BOM을 제거한다', () => {
    const rows = parseCsv('﻿사업장명,도로명전체주소\n가온,서울 강남구');
    expect(rows[0][0]).toBe('사업장명');
  });

  it('districtOf: 광역시명 속 구를 오인하지 않고 실제 구/군을 뽑는다', () => {
    expect(districtOf('서울특별시 종로구 새문안로 29')).toBe('종로구');
    expect(districtOf('대구광역시 중구 국채보상로')).toBe('중구');
    expect(districtOf('인천광역시 강화군 …')).toBe('강화군');
    expect(districtOf('경기도 성남시 분당구 판교로')).toBe('분당구');
    expect(districtOf('경기도 광주시 …')).toBe('광주시');
    expect(districtOf('테헤란로 152')).toBeUndefined();
  });

  it('isOperating: 폐업·취소·휴업 제외, 영업/정상 포함', () => {
    expect(isOperating('영업/정상')).toBe(true);
    expect(isOperating('영업중')).toBe(true);
    expect(isOperating('폐업')).toBe(false);
    expect(isOperating('취소/말소')).toBe(false);
    expect(isOperating('휴업')).toBe(false);
    expect(isOperating('')).toBe(true);
  });

  it('transformRows: 폐업 제외·중복 제거·source 태깅', () => {
    const csv = [
      '사업장명,도로명전체주소,영업상태명',
      '가온예식장,"서울특별시 강남구 테헤란로 1",영업/정상',
      '폐업홀,"서울특별시 마포구 월드컵로 2",폐업',
      '가온예식장,"서울특별시 강남구 테헤란로 1",영업/정상',
    ].join('\n');
    const out = transformRows(parseCsv(csv), 'wedding');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: '가온예식장',
      district: '강남구',
      type: 'wedding',
      source: 'localdata',
    });
  });

  it('transformRows: 사업장명 컬럼이 없으면 던진다', () => {
    expect(() => transformRows(parseCsv('주소\n서울'), 'funeral')).toThrow();
  });
});
