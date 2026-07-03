import type { PpOcrRegion } from './types';

export type DbPostprocessOptions = {
  threshold?: number;
  boxThreshold?: number;
  minArea?: number;
  unclipRatio?: number;
  maxRegions?: number;
};

type Component = {
  pixels: number;
  score: number;
  cornerPoints: PpOcrRegion['cornerPoints'];
};

type DetectorPoint = {
  x: number;
  y: number;
};

function verticalOverlap(left: PpOcrRegion, right: PpOcrRegion) {
  const leftBox = left.boundingBox;
  const rightBox = right.boundingBox;
  const overlap = Math.max(
    0,
    Math.min(leftBox.y + leftBox.height, rightBox.y + rightBox.height) -
      Math.max(leftBox.y, rightBox.y),
  );
  return overlap / Math.max(1, Math.min(leftBox.height, rightBox.height));
}

function horizontalGap(left: PpOcrRegion, right: PpOcrRegion) {
  const leftBox = left.boundingBox;
  const rightBox = right.boundingBox;
  if (leftBox.x + leftBox.width < rightBox.x) {
    return rightBox.x - (leftBox.x + leftBox.width);
  }
  if (rightBox.x + rightBox.width < leftBox.x) {
    return leftBox.x - (rightBox.x + rightBox.width);
  }
  return 0;
}

function mergeTextRows(regions: PpOcrRegion[]): PpOcrRegion[] {
  const rows: PpOcrRegion[] = [];
  regions
    .sort(
      (left, right) =>
        left.boundingBox.y - right.boundingBox.y ||
        left.boundingBox.x - right.boundingBox.x,
    )
    .forEach((region) => {
      const rowIndex = rows.findIndex(
        (row) =>
          verticalOverlap(row, region) >= 0.45 &&
          horizontalGap(row, region) <=
            Math.max(row.boundingBox.height, region.boundingBox.height) * 3,
      );
      if (rowIndex < 0) {
        rows.push(region);
        return;
      }
      const row = rows[rowIndex];
      const left = Math.min(row.boundingBox.x, region.boundingBox.x);
      const top = Math.min(row.boundingBox.y, region.boundingBox.y);
      const right = Math.max(
        row.boundingBox.x + row.boundingBox.width,
        region.boundingBox.x + region.boundingBox.width,
      );
      const bottom = Math.max(
        row.boundingBox.y + row.boundingBox.height,
        region.boundingBox.y + region.boundingBox.height,
      );
      const boundingBox = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
      rows[rowIndex] = {
        score: Math.max(row.score, region.score),
        boundingBox,
        cornerPoints: [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
      };
    });
  return rows;
}

function boundingBoxForPoints(points: PpOcrRegion['cornerPoints']) {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    x: Math.floor(left),
    y: Math.floor(top),
    width: Math.max(1, Math.ceil(right - left)),
    height: Math.max(1, Math.ceil(bottom - top)),
  };
}

function sortBoxCorners(
  points: PpOcrRegion['cornerPoints'],
): PpOcrRegion['cornerPoints'] {
  const center = points.reduce(
    (acc, point) => ({ x: acc.x + point.x / 4, y: acc.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  const sorted = [...points].sort(
    (left, right) =>
      Math.atan2(left.y - center.y, left.x - center.x) -
      Math.atan2(right.y - center.y, right.x - center.x),
  );
  const startIndex = sorted.reduce((bestIndex, point, index) => {
    const best = sorted[bestIndex];
    return point.x + point.y < best.x + best.y ? index : bestIndex;
  }, 0);
  return [
    sorted[startIndex],
    sorted[(startIndex + 1) % 4],
    sorted[(startIndex + 2) % 4],
    sorted[(startIndex + 3) % 4],
  ];
}

function buildOrientedComponent(
  queue: Int32Array,
  count: number,
  probabilityMap: Float32Array,
  mapWidth: number,
  sourceWidth: number,
  sourceHeight: number,
  scaleX: number,
  scaleY: number,
  unclipRatio: number,
): Component {
  const points: DetectorPoint[] = [];
  let score = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;

  for (let index = 0; index < count; index += 1) {
    const current = queue[index];
    const x = current % mapWidth;
    const y = Math.floor(current / mapWidth);
    points.push({ x, y });
    score += probabilityMap[current];
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumYY += y * y;
    sumXY += x * y;
  }

  const centerX = sumX / Math.max(1, count);
  const centerY = sumY / Math.max(1, count);
  const covarianceXX = sumXX / Math.max(1, count) - centerX * centerX;
  const covarianceYY = sumYY / Math.max(1, count) - centerY * centerY;
  const covarianceXY = sumXY / Math.max(1, count) - centerX * centerY;
  const angle =
    Math.abs(covarianceXY) < 1e-5 &&
    Math.abs(covarianceXX - covarianceYY) < 1e-5
      ? 0
      : 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);
  const normalX = -axisY;
  const normalY = axisX;
  let minAxis = Number.POSITIVE_INFINITY;
  let maxAxis = Number.NEGATIVE_INFINITY;
  let minNormal = Number.POSITIVE_INFINITY;
  let maxNormal = Number.NEGATIVE_INFINITY;

  points.forEach((point) => {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const axisProjection = dx * axisX + dy * axisY;
    const normalProjection = dx * normalX + dy * normalY;
    minAxis = Math.min(minAxis, axisProjection);
    maxAxis = Math.max(maxAxis, axisProjection);
    minNormal = Math.min(minNormal, normalProjection);
    maxNormal = Math.max(maxNormal, normalProjection);
  });

  const axisPadding = Math.max(
    1,
    ((maxAxis - minAxis + 1) * (unclipRatio - 1)) / 2,
  );
  const normalPadding = Math.max(
    1,
    ((maxNormal - minNormal + 1) * (unclipRatio - 1)) / 2,
  );
  minAxis -= axisPadding;
  maxAxis += axisPadding;
  minNormal -= normalPadding;
  maxNormal += normalPadding;

  const toSourcePoint = (axisProjection: number, normalProjection: number) => {
    const x =
      (centerX + axisProjection * axisX + normalProjection * normalX) * scaleX;
    const y =
      (centerY + axisProjection * axisY + normalProjection * normalY) * scaleY;
    return {
      x: Math.max(0, Math.min(sourceWidth, x)),
      y: Math.max(0, Math.min(sourceHeight, y)),
    };
  };

  const cornerPoints = sortBoxCorners([
    toSourcePoint(minAxis, minNormal),
    toSourcePoint(maxAxis, minNormal),
    toSourcePoint(maxAxis, maxNormal),
    toSourcePoint(minAxis, maxNormal),
  ]);

  return {
    pixels: count,
    score: count ? score / count : 0,
    cornerPoints,
  };
}

const NEIGHBORS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

export function extractDbTextRegions(
  probabilityMap: Float32Array,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  options: DbPostprocessOptions = {},
): PpOcrRegion[] {
  const threshold = options.threshold ?? 0.3;
  const boxThreshold = options.boxThreshold ?? 0.5;
  const minArea = options.minArea ?? 12;
  const unclipRatio = options.unclipRatio ?? 1.6;
  const maxRegions = options.maxRegions ?? 96;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components: Component[] = [];
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (visited[start] || probabilityMap[start] < threshold) continue;

      let head = 0;
      let tail = 0;
      let score = 0;
      queue[tail++] = start;
      visited[start] = 1;

      while (head < tail) {
        const current = queue[head++];
        const currentX = current % width;
        const currentY = Math.floor(current / width);
        score += probabilityMap[current];

        NEIGHBORS.forEach(([dx, dy]) => {
          const nextX = currentX + dx;
          const nextY = currentY + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
            return;
          }
          const next = nextY * width + nextX;
          if (!visited[next] && probabilityMap[next] >= threshold) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        });
      }

      const pixels = tail;
      const averageScore = pixels ? score / pixels : 0;
      if (pixels >= minArea && averageScore >= boxThreshold) {
        components.push(
          buildOrientedComponent(
            queue,
            tail,
            probabilityMap,
            width,
            sourceWidth,
            sourceHeight,
            scaleX,
            scaleY,
            unclipRatio,
          ),
        );
      }
    }
  }

  return mergeTextRows(
    components
      .map((component): PpOcrRegion => {
        const boundingBox = boundingBoxForPoints(component.cornerPoints);
        return {
          score: component.score,
          boundingBox,
          cornerPoints: component.cornerPoints,
        };
      })
      .filter(
        ({ boundingBox }) =>
          boundingBox.width >= 8 &&
          boundingBox.height >= 6 &&
          boundingBox.width * boundingBox.height <
            sourceWidth * sourceHeight * 0.6,
      ),
  )
    .sort(
      (left, right) =>
        left.boundingBox.y - right.boundingBox.y ||
        left.boundingBox.x - right.boundingBox.x,
    )
    .slice(0, maxRegions);
}
