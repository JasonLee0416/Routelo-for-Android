// 지방행정 인허가데이터(LOCALDATA) CSV → 사전 스키마 변환 순수 함수 (#150).
// CommonJS로 두어 CLI(.mjs, ESM named import)와 jest(.js 트랜스폼) 양쪽에서 재사용한다.

// LOCALDATA 표준 컬럼명(한글 헤더). 데이터셋에 따라 소재지/도로명 중 하나만 있을 수 있다.
const COL = {
  name: ['사업장명', '상호명', '업소명'],
  roadAddr: ['도로명전체주소', '도로명주소'],
  lotAddr: ['소재지전체주소', '지번주소', '소재지주소'],
  state: ['영업상태명', '상세영업상태명'],
};

// 아주 작은 CSV 파서(따옴표 필드 지원). 대량 데이터엔 충분하고 의존성 없음.
// 선두 BOM(﻿)을 제거한다 — Windows/PowerShell로 UTF-8 변환한 CSV가 BOM을
// 달고 오면 첫 헤더 컬럼명이 어긋나 컬럼 매칭이 깨진다.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
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
function districtOf(address) {
  if (!address) return undefined;
  const tokens = address.split(/\s+/).filter(Boolean);
  const gu = tokens.find(
    (t) => /[가-힣]+(구|군)$/.test(t) && !/(광역시|특별시)$/.test(t),
  );
  if (gu) return gu;
  const si = tokens.find(
    (t) => /[가-힣]+시$/.test(t) && !/(광역시|특별시)$/.test(t),
  );
  return si;
}

// 영업 중만 남긴다(폐업/취소/말소/휴업 제외).
function isOperating(state) {
  if (!state) return true; // 상태 컬럼이 없으면 보수적으로 포함
  return /영업|정상/.test(state) && !/폐업|취소|말소|직권|휴업/.test(state);
}

function transformRows(rows, type) {
  if (!rows.length) return [];
  const header = rows[0];
  const iName = pick(header, COL.name);
  const iRoad = pick(header, COL.roadAddr);
  const iLot = pick(header, COL.lotAddr);
  const iState = pick(header, COL.state);
  if (iName < 0) {
    throw new Error('사업장명 컬럼을 찾지 못했습니다. CSV 헤더를 확인하세요.');
  }

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

module.exports = { COL, parseCsv, districtOf, isOperating, transformRows };
