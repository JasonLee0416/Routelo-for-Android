import {
  RgbaImage,
  stripWidthForQuad,
  warpQuadToStrip,
  WarpPoint,
} from '../warp';

// 위치 인코딩 소스: R=x, G=y (샘플 좌표를 값으로 검증하기 위함).
const positionSrc = (w: number, h: number): RgbaImage => {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      rgba[o] = x * 10;
      rgba[o + 1] = y * 10;
      rgba[o + 2] = 0;
      rgba[o + 3] = 255;
    }
  }
  return { width: w, height: h, rgba };
};

const px = (img: RgbaImage, x: number, y: number) => {
  const o = (y * img.width + x) * 4;
  return { r: img.rgba[o], g: img.rgba[o + 1] };
};

describe('warpQuadToStrip', () => {
  it('is identity for a full-cover axis-aligned quad', () => {
    const src = positionSrc(4, 4);
    const quad: [WarpPoint, WarpPoint, WarpPoint, WarpPoint] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ];
    const out = warpQuadToStrip(src, quad, 4, 4);
    // 각 목적 픽셀은 소스의 동일 좌표를 샘플 → R=x*10, G=y*10.
    expect(px(out, 1, 2)).toEqual({ r: 10, g: 20 });
    expect(px(out, 3, 3)).toEqual({ r: 30, g: 30 });
  });

  it('deskews a rotated quad (maps the quad edges onto the strip axes)', () => {
    const src = positionSrc(4, 4);
    // 90° 회전 사각형: TL=(0,3), TR=(0,0), BR=(3,0), BL=(3,3).
    const quad: [WarpPoint, WarpPoint, WarpPoint, WarpPoint] = [
      { x: 0, y: 3 },
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ];
    const out = warpQuadToStrip(src, quad, 4, 4);
    // 스트립 좌상단(u=0,v=0) = quad TL = 소스(0,3) → G=30.
    expect(px(out, 0, 0).g).toBe(30);
    // 스트립 우상단(u=1,v=0) = quad TR = 소스(0,0) → G=0.
    expect(px(out, 3, 0).g).toBe(0);
  });

  it('pads out-of-range samples with white', () => {
    const src = positionSrc(4, 4);
    const quad: [WarpPoint, WarpPoint, WarpPoint, WarpPoint] = [
      { x: -10, y: -10 },
      { x: -8, y: -10 },
      { x: -8, y: -8 },
      { x: -10, y: -8 },
    ];
    const out = warpQuadToStrip(src, quad, 2, 2);
    expect(px(out, 0, 0)).toEqual({ r: 255, g: 255 });
  });
});

describe('stripWidthForQuad', () => {
  it('scales width by the quad aspect ratio, clamped to max', () => {
    const wide: [WarpPoint, WarpPoint, WarpPoint, WarpPoint] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 20 },
      { x: 0, y: 20 },
    ];
    // 200x20 → 48*(200/20)=480 → 320 상한.
    expect(stripWidthForQuad(wide, 48, 320)).toBe(320);
    const square: [WarpPoint, WarpPoint, WarpPoint, WarpPoint] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(stripWidthForQuad(square, 48, 320)).toBe(48);
  });
});
