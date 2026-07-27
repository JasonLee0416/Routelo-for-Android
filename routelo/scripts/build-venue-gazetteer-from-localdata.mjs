// 지방행정 인허가데이터(구 LOCALDATA → data.go.kr 통합) CSV → 사전 스키마 변환 (#150).
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
//   - LOCALDATA CSV는 보통 EUC-KR 인코딩 → UTF-8로 변환 후 입력할 것.
//   - 공공누리 유형 확인(제1유형=상용 OK / 제4유형=상용 금지) 후 사용.

import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

// LOCALDATA 표준 컬럼명(한글 헤더). 데이터셋에 따라 소재지/도로명 중 하나만 있을 수 있다.
const COL = {
  name: ['사업장명', '상호명', '업소명'],
  roadAddr: ['도로명전체주소', '도로명주소'],
  lotAddr: ['소재지전체주소', '지번주소', '소재지주소'],
  state: ['영업상태명', '상세영업상태명'],
};

// 아주 작은 CSV 파서(따옴표 필드 지원). 대량 데이터엔 충분하고 의존성 없음.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const pick = (header, candidates) => {
  for (const c of candidates) {
    const idx = header.indexOf(c);
    if (idx >= 0) return idx;
  }
  return -1;
};

// 주소에서 행정구역(구/군) 추출: "서울특별시 종로구 …" → "종로구".
// 공백 토큰 단위로 찾아 "대구광역시"(시 이름 속 '구')를 구로 오인하지 않는다.
// 구/군이 없으면 시(예: 성남시) 토큰을 반환한다.
export function districtOf(address) {
  if (!address) return undefined;
  const tokens = address.split(/\s+/).filter(Boolean);
  const gu = tokens.find((t) => /[가-힣]+(구|군)$/.test(t) && !/(광역시|특별시)$/.test(t));
  if (gu) return gu;
  const si = tokens.find((t) => /[가-힣]+시$/.test(t) && !/(광역시|특별시)$/.test(t));
  return si;
}

// 영업 중만 남긴다(폐업/취소/말소 제외).
export function isOperating(state) {
  if (!state) return true; // 상태 컬럼이 없으면 보수적으로 포함
  return /영업|정상/.test(state) && !/폐업|취소|말소|직권/.test(state);
}

export function transformRows(rows, type) {
  if (!rows.length) return [];
  const header = rows[0];
  const iName = pick(header, COL.name);
  const iRoad = pick(header, COL.roadAddr);
  const iLot = pick(header, COL.lotAddr);
  const iState = pick(header, COL.state);
  if (iName < 0) throw new Error('사업장명 컬럼을 찾지 못했습니다. CSV 헤더를 확인하세요.');

  const out = [];
  const seen = new Set();
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const name = (row[iName] || '').trim();
    if (!name) continue;
    const state = iState >= 0 ? (row[iState] || '').trim() : '';
    if (!isOperating(state)) continue;
    const address = (
      (iRoad >= 0 ? row[iRoad] : '') ||
      (iLot >= 0 ? row[iLot] : '') ||
      ''
    ).trim();
    // 주소+상호 기준 dedupe.
    const key = `${name}|${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      aliases: [],
      district: districtOf(address),
      address: address || undefined,
      type,
      source: 'localdata',
    });
  }
  return out;
}

function selftest() {
  const csv = [
    '사업장명,도로명전체주소,영업상태명',
    '가온예식장,"서울특별시 강남구 테헤란로 1",영업/정상',
    '폐업웨딩홀,"서울특별시 마포구 월드컵로 2",폐업',
    '가온예식장,"서울특별시 강남구 테헤란로 1",영업/정상',
    '중앙대병원 장례식장,"서울특별시 동작구 흑석로 102",영업',
  ].join('\n');
  const rows = parseCsv(csv);
  const out = transformRows(rows, 'wedding');
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
  const args = process.argv.slice(2);
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
    console.error("--type 은 funeral 또는 wedding 이어야 합니다.");
    process.exit(1);
  }
  const text = readFileSync(input, 'utf8');
  const records = transformRows(parseCsv(text), type);
  writeFileSync(out, JSON.stringify(records, null, 2) + '\n');
  console.log(`변환 완료: ${records.length}건 → ${out} (source=localdata, type=${type})`);
}

// 직접 실행일 때만 main() 실행(테스트/재사용 import 시엔 순수 함수만 노출).
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  main();
}
