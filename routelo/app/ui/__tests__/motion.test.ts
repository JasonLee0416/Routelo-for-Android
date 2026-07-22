import { barRiseStart, NAV_RIPPLE, PROFIT_BARS } from '../motion';

describe('motion timing', () => {
  it('staggers profit bars left to right and caps the delay', () => {
    expect(barRiseStart(0)).toBe(0);
    expect(barRiseStart(1)).toBeCloseTo(PROFIT_BARS.staggerStep, 5);
    // 뒤쪽 막대가 끝없이 밀려 애니메이션이 끊겨 보이지 않도록 상한을 둔다.
    expect(barRiseStart(100)).toBe(PROFIT_BARS.maxStagger);
    expect(barRiseStart(3)).toBeLessThan(barRiseStart(4));
  });

  it('keeps the last bar within the animation window', () => {
    // 가장 늦게 시작하는 막대도 진행도 1 이전에 다 차올라야 한다.
    expect(PROFIT_BARS.maxStagger + PROFIT_BARS.riseWindow).toBeLessThanOrEqual(1);
  });

  it('fades the nav ripple out as it expands', () => {
    expect(NAV_RIPPLE.fromOpacity).toBeGreaterThan(0);
    expect(NAV_RIPPLE.toScale).toBeGreaterThan(NAV_RIPPLE.fromScale);
    expect(NAV_RIPPLE.durationMs).toBeGreaterThan(0);
  });
});
