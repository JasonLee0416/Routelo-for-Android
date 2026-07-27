import { estimateSkewDegrees, type DeskewLineBox } from '../deskew';

// 수평 텍스트 라인 그리드(행 rows × 열 cols)의 중심점을 각도 α(도)로 회전시켜
// "기울어진 인수증"을 합성한다. 각 라인 박스는 폭 w, 높이 h.
function skewedGrid(
  alphaDeg: number,
  { rows = 10, cols = 3, dx = 120, dy = 40, w = 90, h = 24, x0 = 200, y0 = 200 } = {},
): DeskewLineBox[] {
  const rad = (alphaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lines: DeskewLineBox[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cx = x0 + c * dx;
      const cy = y0 + r * dy;
      // 중심을 α로 회전
      const rx = cx * cos - cy * sin;
      const ry = cx * sin + cy * cos;
      lines.push({
        boundingBox: { x: rx - w / 2, y: ry - h / 2, width: w, height: h },
      });
    }
  }
  return lines;
}

describe('estimateSkewDegrees', () => {
  it('수평 문서는 기울기 0, 회전 불필요(confident=false)', () => {
    const result = estimateSkewDegrees(skewedGrid(0));
    expect(Math.abs(result.degrees)).toBeLessThan(1.5);
    expect(result.confident).toBe(false);
  });

  it('양의 각도로 기울인 문서의 각도를 근사 추정한다', () => {
    const result = estimateSkewDegrees(skewedGrid(7));
    expect(result.confident).toBe(true);
    expect(result.degrees).toBeGreaterThan(5);
    expect(result.degrees).toBeLessThan(9);
  });

  it('음의 각도로 기울인 문서의 부호도 맞춘다', () => {
    const result = estimateSkewDegrees(skewedGrid(-9));
    expect(result.confident).toBe(true);
    expect(result.degrees).toBeLessThan(-6);
    expect(result.degrees).toBeGreaterThan(-12);
  });

  it('라인 표본이 부족하면 추정하지 않는다', () => {
    const few: DeskewLineBox[] = [
      { boundingBox: { x: 0, y: 0, width: 50, height: 20 } },
      { boundingBox: { x: 0, y: 40, width: 50, height: 20 } },
    ];
    const result = estimateSkewDegrees(few);
    expect(result.confident).toBe(false);
    expect(result.degrees).toBe(0);
  });

  it('boundingBox 없는 라인은 무시한다', () => {
    const mixed = [...skewedGrid(6), { text: 'no-box' } as DeskewLineBox];
    const result = estimateSkewDegrees(mixed);
    expect(result.confident).toBe(true);
    expect(result.sampleLines).toBe(30);
  });

  it('과도한 각도(임계 초과)는 confident로 잡되 범위 내로 제한한다', () => {
    const result = estimateSkewDegrees(skewedGrid(14), { maxAbsDegrees: 20 });
    expect(result.confident).toBe(true);
    expect(Math.abs(result.degrees)).toBeLessThanOrEqual(20);
    expect(result.degrees).toBeGreaterThan(11);
  });
});
