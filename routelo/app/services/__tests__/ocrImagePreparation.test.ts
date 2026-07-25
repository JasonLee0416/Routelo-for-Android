import { BRIGHTNESS_IDEAL, scoreBrightness } from '../ocrImagePreparation';

describe('scoreBrightness (#122 overexposure gate)', () => {
  it('does not reject a bright white-background document as under-lit', () => {
    // 흰 배경이 큰 스캔/캡처 문서는 mean이 0.9 안팎으로 높은 게 정상.
    // 예전 대칭 감점(|mean-0.66|*115 + blown*45)이면 40 미만으로 막혔지만,
    // 이제 밝은 쪽은 약하게 감점하므로 게이트(55)를 통과해야 한다.
    const score = scoreBrightness(0.9, 0.02, 0.35);
    expect(score).toBeGreaterThanOrEqual(55);
  });

  it('still penalizes genuinely dark (low-contrast) frames hard', () => {
    // 어두운 프레임은 글자 대비 손실로 인식을 직접 해치므로 강하게 감점.
    expect(scoreBrightness(0.3, 0.2, 0)).toBeLessThan(55);
  });

  it('scores an ideally-lit frame near the top', () => {
    expect(scoreBrightness(BRIGHTNESS_IDEAL, 0, 0)).toBe(100);
  });

  it('penalizes the dark side harder than the equally-off bright side', () => {
    const delta = 0.2;
    const dark = scoreBrightness(BRIGHTNESS_IDEAL - delta, 0, 0);
    const bright = scoreBrightness(BRIGHTNESS_IDEAL + delta, 0, 0);
    expect(bright).toBeGreaterThan(dark);
  });
});
