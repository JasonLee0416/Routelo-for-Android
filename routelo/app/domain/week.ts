// 인수증 보관함의 "주별" 그룹핑용 순수 헬퍼.
//
// 저장 시각(capturedAt)은 UTC ISO 문자열이지만 사용자는 한국(KST) 기준으로
// 주를 인식하므로, +9시간 시프트한 벽시계 날짜로 ISO-8601 주를 계산한다.
// weekKey는 정렬·그룹핑용(예: "2026-W24"), weekRangeLabel은 표시용
// 월요일~일요일 날짜 범위(예: "2026.06.08 ~ 06.14").

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// UTC getter가 KST 벽시계를 돌려주도록 +9h 시프트한 Date를 만든다.
function toKstWallClock(iso: string): Date | undefined {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed + KST_OFFSET_MS);
}

// 월요일=0 … 일요일=6
function isoWeekday(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

// 해당 주의 목요일(ISO 주 기준점)로 이동한 Date.
function thursdayOfWeek(date: Date): Date {
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(shifted.getUTCDate() - isoWeekday(shifted) + 3);
  return shifted;
}

export type IsoWeek = { year: number; week: number };

export function isoWeekOf(iso: string): IsoWeek | undefined {
  const date = toKstWallClock(iso);
  if (!date) return undefined;
  const thursday = thursdayOfWeek(date);
  const year = thursday.getUTCFullYear();
  const firstThursday = thursdayOfWeek(new Date(Date.UTC(year, 0, 4)));
  const week =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { year, week };
}

// 정렬·그룹핑용 안정 키. 사전순 정렬이 곧 시간순이 되도록 zero-pad.
export function isoWeekKey(iso: string): string {
  const parsed = isoWeekOf(iso);
  if (!parsed) return 'unknown';
  return `${parsed.year}-W${String(parsed.week).padStart(2, '0')}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

// 그 주의 월요일(KST) Date.
function mondayOfWeek(iso: string): Date | undefined {
  const date = toKstWallClock(iso);
  if (!date) return undefined;
  const monday = new Date(date.getTime());
  monday.setUTCDate(monday.getUTCDate() - isoWeekday(monday));
  return monday;
}

// 표시용 월~일 범위 라벨(KST). 예: "2026.06.08 ~ 06.14".
export function weekRangeLabel(iso: string): string {
  const monday = mondayOfWeek(iso);
  if (!monday) return '날짜 미상';
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const start = `${monday.getUTCFullYear()}.${pad2(monday.getUTCMonth() + 1)}.${pad2(
    monday.getUTCDate(),
  )}`;
  const end = `${pad2(sunday.getUTCMonth() + 1)}.${pad2(sunday.getUTCDate())}`;
  return `${start} ~ ${end}`;
}
