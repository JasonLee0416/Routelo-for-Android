// 지방행정 인허가데이터(구 LOCALDATA → data.go.kr 통합) CSV → 사전 스키마 변환 CLI (#150).
//
// 목적: 크롤링 유래 데이터를 공공데이터로 대체해 저작권법 §93·부정경쟁방지법 (파)목·
// 지도서비스 약관 리스크를 원천 제거한다(#149 참조). 산출 레코드는 source:'localdata'.
//
// 사용:
//   node scripts/build-venue-gazetteer-from-localdata.mjs \
//     --input <localdata.csv> --type funeral|wedding --out <out.json>
//   node scripts/build-venue-gazetteer-from-localdata.mjs --selftest
//
// 입력(사용자 제공 필요): 예식장업 / 장례식장(장사시설) 인허가 CSV.
//   - data.go.kr(지방행정 인허가데이터)에서 다운로드. 계정/키가 필요할 수 있음.
//   - LOCALDATA CSV는 보통 EUC-KR 인코딩 → UTF-8로 변환 후 입력할 것(BOM 있어도 처리됨).
//   - 공공누리 유형 확인(제1유형=상용 OK / 제4유형=상용 금지) 후 사용.
//
// 순수 변환 로직은 scripts/localdataTransform.js(CommonJS)에 있고 jest로 검증한다.

import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parseCsv, transformRows } = require('./localdataTransform.js');

function selftest() {
  const csv = [
    '사업장명,도로명전체주소,영업상태명',
    '가온예식장,"서울특별시 강남구 테헤란로 1",영업/정상',
    '폐업웨딩홀,"서울특별시 마포구 월드컵로 2",폐업',
    '가온예식장,"서울특별시 강남구 테헤란로 1",영업/정상',
    '중앙대병원 장례식장,"서울특별시 동작구 흑석로 102",영업',
  ].join('\n');
  const out = transformRows(parseCsv(csv), 'wedding');
  const ok =
    out.length === 2 &&
    out[0].name === '가온예식장' &&
    out[0].district === '강남구' &&
    out[0].source === 'localdata' &&
    out[1].name === '중앙대병원 장례식장' &&
    out[1].district === '동작구';
  if (!ok) {
    console.error('SELFTEST FAILED', JSON.stringify(out, null, 2));
    process.exit(1);
  }
  console.log('selftest OK — 폐업 제외·중복 제거·구 추출·source 태깅 정상 (2건)');
}

function main() {
  const args = argv.slice(2);
  if (args.includes('--selftest')) return selftest();
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const input = get('--input');
  const type = get('--type');
  const out = get('--out');
  if (!input || !type || !out) {
    console.error(
      '사용: node scripts/build-venue-gazetteer-from-localdata.mjs --input <csv> --type funeral|wedding --out <json>\n' +
        '또는: --selftest',
    );
    process.exit(1);
  }
  if (type !== 'funeral' && type !== 'wedding') {
    console.error('--type 은 funeral 또는 wedding 이어야 합니다.');
    process.exit(1);
  }
  const text = readFileSync(input, 'utf8');
  const records = transformRows(parseCsv(text), type);
  writeFileSync(out, JSON.stringify(records, null, 2) + '\n');
  console.log(`변환 완료: ${records.length}건 → ${out} (source=localdata, type=${type})`);
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
