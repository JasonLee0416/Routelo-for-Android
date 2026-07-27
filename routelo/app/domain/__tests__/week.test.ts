import { isoWeekKey, isoWeekOf, weekRangeLabel } from '../week';

describe('week grouping helpers (KST)', () => {
  it('같은 주(월~일)의 날짜는 같은 weekKey를 갖는다', () => {
    // 2026-06-08(월) ~ 2026-06-14(일) KST는 한 주.
    const mon = isoWeekKey('2026-06-08T09:00:00.000Z');
    const sun = isoWeekKey('2026-06-14T09:00:00.000Z');
    expect(mon).toBe(sun);
  });

  it('다음 주 월요일은 다른 weekKey를 갖는다', () => {
    const sun = isoWeekKey('2026-06-14T09:00:00.000Z');
    const nextMon = isoWeekKey('2026-06-15T09:00:00.000Z');
    expect(nextMon).not.toBe(sun);
  });

  it('weekKey는 사전순 정렬이 시간순과 일치한다(zero-pad)', () => {
    const earlier = isoWeekKey('2026-03-02T00:00:00.000Z');
    const later = isoWeekKey('2026-11-02T00:00:00.000Z');
    expect(earlier < later).toBe(true);
    expect(earlier).toMatch(/^2026-W\d{2}$/);
  });

  it('KST 자정 경계: UTC로는 전날이어도 KST 날짜 기준으로 그룹핑한다', () => {
    // 2026-06-14T20:00Z = 2026-06-15T05:00 KST(월) → 다음 주.
    const kstMonday = isoWeekKey('2026-06-14T20:00:00.000Z');
    const kstSunday = isoWeekKey('2026-06-14T09:00:00.000Z'); // 18:00 KST 일요일
    expect(kstMonday).not.toBe(kstSunday);
  });

  it('weekRangeLabel은 월~일 범위를 보여준다', () => {
    const label = weekRangeLabel('2026-06-10T09:00:00.000Z'); // 수요일
    expect(label).toBe('2026.06.08 ~ 06.14');
  });

  it('잘못된 날짜는 방어적으로 처리한다', () => {
    expect(isoWeekOf('not-a-date')).toBeUndefined();
    expect(isoWeekKey('not-a-date')).toBe('unknown');
    expect(weekRangeLabel('not-a-date')).toBe('날짜 미상');
  });
});
