import { fixConfusableDigits } from '../confusables';

describe('fixConfusableDigits', () => {
  it('fixes confusable letters inside digit-context runs', () => {
    expect(fixConfusableDigits('O1O-l234-5678')).toBe('010-1234-5678');
    expect(fixConfusableDigits('2O26.O7.O5')).toBe('2026.07.05');
    expect(fixConfusableDigits('l4:3O')).toBe('14:30');
    expect(fixConfusableDigits('S8-l23')).toBe('58-123');
  });

  it('leaves Korean text and non-numeric tokens untouched', () => {
    expect(fixConfusableDigits('홍길동')).toBe('홍길동');
    expect(fixConfusableDigits('전화 O1O-1234-5678')).toBe(
      '전화 010-1234-5678',
    );
    // 숫자가 1개뿐인 토큰은 교정하지 않는다(보수적).
    expect(fixConfusableDigits('S1')).toBe('S1');
    // 숫자가 없는 토큰은 그대로.
    expect(fixConfusableDigits('ABC')).toBe('ABC');
  });
});
