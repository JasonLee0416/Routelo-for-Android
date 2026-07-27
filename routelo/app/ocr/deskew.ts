// 인수증 deskew(기울기 보정) 각도 추정.
//
// ML Kit이 넘겨주는 텍스트 라인의 boundingBox 중심점만으로 문서 전체 회전각을
// 추정한다(원본 픽셀 접근 불필요). 표준 "projection profile" 기법:
//   - 후보 각도 θ마다 각 라인 중심을 -θ 회전시킨 y좌표를 구한다.
//   - 문서가 실제로 θ만큼 기울어져 있었다면, 역회전 후 같은 논리 행의 라인들이
//     비슷한 y로 모여 히스토그램이 뾰족해진다(행 분리도↑).
//   - 행 분리도(버킷 정렬 점수)가 최대가 되는 θ가 추정 기울기.
//
// 라인 박스만 쓰므로 구겨진 종이 윤곽(PCA)보다 텍스트 실제 기울기에 충실하다.
// 반환 degrees는 "문서가 기울어진 각도"이다(0 = 수평). 이미지를 똑바로 세우려면
// 호출부가 이 값의 반대 부호로 회전한다(rotate: -degrees). 이미지 좌표계(y 아래로
// 증가)에서 회전 방향(시계/반시계)은 최종적으로 실기기에서 확정하되, 2-pass의
// "더 나은 쪽 채택" 안전장치가 부호 오류 시 원본으로 폴백해준다.

export type DeskewLineBox = {
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type Point = { x: number; y: number; h: number };

function centers(lines: DeskewLineBox[]): Point[] {
  const points: Point[] = [];
  for (const line of lines) {
    const box = line.boundingBox;
    if (!box || box.width <= 0 || box.height <= 0) continue;
    points.push({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      h: box.height,
    });
  }
  return points;
}

// 주어진 각도로 역회전한 y좌표들이 얼마나 뚜렷한 행으로 뭉치는지 점수화한다.
// 버킷(=중앙 라인 높이)별 개수의 제곱합(엔트로피 반대 개념) — 몰릴수록 커진다.
function rowSeparationScore(points: Point[], angleRad: number, bucket: number) {
  const sin = Math.sin(angleRad);
  const cos = Math.cos(angleRad);
  const buckets = new Map<number, number>();
  for (const point of points) {
    // -θ 회전 후 y' = -x*sin(-θ)+y*cos(-θ) = x*sinθ + y*cosθ ... 부호는
    // rotate 규약과 맞추기 위해 아래처럼 둔다(θ>0: 반시계로 기운 문서를 편다).
    const rotatedY = point.y * cos - point.x * sin;
    const key = Math.round(rotatedY / bucket);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  let score = 0;
  for (const count of buckets.values()) {
    score += count * count;
  }
  return score;
}

export type SkewEstimate = {
  degrees: number;
  confident: boolean;
  sampleLines: number;
};

/**
 * 라인 박스들로 문서가 기울어진 각도(도)를 추정한다(0 = 수평).
 * 보정 회전은 호출부가 `-degrees`로 수행한다.
 *
 * confident=false면 표본이 부족하거나 추정이 불안정하므로 호출부는 회전을
 * 건너뛰어야 한다.
 */
export function estimateSkewDegrees(
  lines: DeskewLineBox[],
  {
    maxAbsDegrees = 20,
    stepDegrees = 0.5,
    minLines = 6,
  }: { maxAbsDegrees?: number; stepDegrees?: number; minLines?: number } = {},
): SkewEstimate {
  const points = centers(lines);
  if (points.length < minLines) {
    return { degrees: 0, confident: false, sampleLines: points.length };
  }
  const medianHeight = median(points.map((p) => p.h));
  const bucket = Math.max(1, medianHeight * 0.6);

  let bestAngle = 0;
  let bestScore = -Infinity;
  let zeroScore = 0;
  for (
    let deg = -maxAbsDegrees;
    deg <= maxAbsDegrees + 1e-9;
    deg += stepDegrees
  ) {
    const rad = (deg * Math.PI) / 180;
    const score = rowSeparationScore(points, rad, bucket);
    if (Math.abs(deg) < 1e-9) zeroScore = score;
    if (score > bestScore) {
      bestScore = score;
      bestAngle = deg;
    }
  }

  // 0도(무보정) 대비 개선이 미미하면 회전하지 않는다(부정확한 미세 회전 방지).
  const improvement = zeroScore > 0 ? (bestScore - zeroScore) / zeroScore : 0;
  const confident =
    Math.abs(bestAngle) >= 1.5 && improvement >= 0.02 && Math.abs(bestAngle) <= maxAbsDegrees;

  return {
    degrees: Number(bestAngle.toFixed(2)),
    confident,
    sampleLines: points.length,
  };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
