// 방향성 텍스트 사각형을 인식기용 수평 스트립으로 펴는 순수 이미지 워프.
// native 의존이 없어 단위 테스트 가능. image.ts에서 사용한다.

export type RgbaImage = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

export type WarpPoint = { x: number; y: number };

export const pointDistance = (a: WarpPoint, b: WarpPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

// 소스 RGBA에서 (x,y)를 바이리니어 샘플. 범위 밖이면 흰색(패딩)으로 채운다.
export function sampleBilinear(
  src: RgbaImage,
  x: number,
  y: number,
  out: Uint8Array,
  outOffset: number,
) {
  if (x < 0 || y < 0 || x > src.width - 1 || y > src.height - 1) {
    out[outOffset] = 255;
    out[outOffset + 1] = 255;
    out[outOffset + 2] = 255;
    out[outOffset + 3] = 255;
    return;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(src.width - 1, x0 + 1);
  const y1 = Math.min(src.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 4; c += 1) {
    const p00 = src.rgba[(y0 * src.width + x0) * 4 + c];
    const p10 = src.rgba[(y0 * src.width + x1) * 4 + c];
    const p01 = src.rgba[(y1 * src.width + x0) * 4 + c];
    const p11 = src.rgba[(y1 * src.width + x1) * 4 + c];
    const top = p00 + (p10 - p00) * fx;
    const bottom = p01 + (p11 - p01) * fx;
    out[outOffset + c] = Math.round(top + (bottom - top) * fy);
  }
}

// 방향성 사각형(TL, TR, BR, BL)을 targetWidth×targetHeight 수평 스트립으로 워프한다.
// 바이리니어 코너 블렌드로 기울기/원근을 편다 → 인식기가 정규 수평 텍스트를 받는다.
export function warpQuadToStrip(
  src: RgbaImage,
  quad: [WarpPoint, WarpPoint, WarpPoint, WarpPoint],
  targetWidth: number,
  targetHeight: number,
): RgbaImage {
  const [tl, tr, br, bl] = quad;
  const rgba = new Uint8Array(targetWidth * targetHeight * 4);
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const v = targetHeight > 1 ? ty / (targetHeight - 1) : 0;
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const u = targetWidth > 1 ? tx / (targetWidth - 1) : 0;
      const topX = tl.x + (tr.x - tl.x) * u;
      const topY = tl.y + (tr.y - tl.y) * u;
      const botX = bl.x + (br.x - bl.x) * u;
      const botY = bl.y + (br.y - bl.y) * u;
      const sx = topX + (botX - topX) * v;
      const sy = topY + (botY - topY) * v;
      sampleBilinear(src, sx, sy, rgba, (ty * targetWidth + tx) * 4);
    }
  }
  return { width: targetWidth, height: targetHeight, rgba };
}

// 사각형에서 인식기 스트립 폭 계산(높이 대비 비율, 상한 적용).
export function stripWidthForQuad(
  quad: [WarpPoint, WarpPoint, WarpPoint, WarpPoint],
  targetHeight: number,
  maxWidth: number,
): number {
  const [tl, tr, br, bl] = quad;
  const quadWidth = (pointDistance(tl, tr) + pointDistance(bl, br)) / 2;
  const quadHeight = (pointDistance(tl, bl) + pointDistance(tr, br)) / 2;
  return Math.max(
    8,
    Math.min(
      maxWidth,
      Math.round((targetHeight * quadWidth) / Math.max(1, quadHeight)),
    ),
  );
}
