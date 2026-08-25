export type Point = { x: number; y: number };

export type MaskMetrics = {
  dice: number;
  jaccard: number;
  areaA: number;
  areaB: number;
  intersectionArea: number;
  volumeRatio: number;
};

export type DistanceMetrics = {
  aToB: number[];
  bToA: number[];
  aClosest: number[];
  bClosest: number[];
  surfaceDice: number;
  meanSurfaceDistance: number;
  hausdorffPercentile: number;
  maximumHausdorff: number;
  maxPointA: Point;
  maxPointB: Point;
  addedPathLength: number;
};

export type ContourMetrics = MaskMetrics &
  DistanceMetrics & {
    centerDistance: number;
    pointsA: Point[];
    pointsB: Point[];
    threshold: number;
    percentile: number;
    overlapMethod: "analytic circles" | "rasterised contours";
  };

export type CircleParameters = {
  circle1X: number;
  circle1Y: number;
  radius1: number;
  noise1: number;
  circle2X: number;
  circle2Y: number;
  radius2: number;
  noise2: number;
  threshold: number;
  percentile: number;
  samplePoints: number;
  seed1: number;
  seed2: number;
};

export const WORLD_MIN = -10;
export const WORLD_MAX = 10;
export const WORLD_SPAN = WORLD_MAX - WORLD_MIN;
export const MASK_SIZE = 256;

const EPSILON = 1e-9;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: Number.NaN, y: Number.NaN };
  if (points.length < 3 || polygonArea(points) < EPSILON) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }

  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    crossSum += cross;
    xSum += (current.x + next.x) * cross;
    ySum += (current.y + next.y) * cross;
  }
  const factor = 1 / (3 * crossSum);
  return { x: xSum * factor, y: ySum * factor };
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function rasterisePolygon(
  polygon: Point[],
  size = MASK_SIZE,
  worldMin = WORLD_MIN,
  worldMax = WORLD_MAX,
): Uint8Array {
  const mask = new Uint8Array(size * size);
  if (polygon.length < 3) return mask;

  const span = worldMax - worldMin;
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minColumn = clamp(Math.floor(((Math.min(...xs) - worldMin) / span) * size), 0, size - 1);
  const maxColumn = clamp(Math.ceil(((Math.max(...xs) - worldMin) / span) * size), 0, size - 1);
  const minRow = clamp(Math.floor(((worldMax - Math.max(...ys)) / span) * size), 0, size - 1);
  const maxRow = clamp(Math.ceil(((worldMax - Math.min(...ys)) / span) * size), 0, size - 1);

  for (let row = minRow; row <= maxRow; row += 1) {
    const y = worldMax - ((row + 0.5) / size) * span;
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const x = worldMin + ((column + 0.5) / size) * span;
      if (pointInPolygon({ x, y }, polygon)) mask[row * size + column] = 1;
    }
  }
  return mask;
}

export function metricsFromMasks(
  maskA: Uint8Array,
  maskB: Uint8Array,
  pixelArea: number,
): MaskMetrics {
  if (maskA.length !== maskB.length) throw new Error("Masks must have matching dimensions.");
  let countA = 0;
  let countB = 0;
  let intersection = 0;
  for (let index = 0; index < maskA.length; index += 1) {
    countA += maskA[index];
    countB += maskB[index];
    if (maskA[index] && maskB[index]) intersection += 1;
  }
  const union = countA + countB - intersection;
  const denominator = countA + countB;
  const larger = Math.max(countA, countB);
  return {
    dice: denominator > 0 ? (2 * intersection) / denominator : 0,
    jaccard: union > 0 ? intersection / union : 0,
    areaA: countA * pixelArea,
    areaB: countB * pixelArea,
    intersectionArea: intersection * pixelArea,
    volumeRatio: larger > 0 ? Math.min(countA, countB) / larger : 0,
  };
}

export function resampleClosedPolygon(points: Point[], numberOfPoints = 400): Point[] {
  if (points.length < 2 || numberOfPoints <= 0) return [];
  const segmentLengths: number[] = [];
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const length = distance(points[index], points[(index + 1) % points.length]);
    segmentLengths.push(length);
    perimeter += length;
  }
  if (perimeter < EPSILON) return [];

  const result: Point[] = [];
  let segmentIndex = 0;
  let segmentStartLength = 0;
  for (let sampleIndex = 0; sampleIndex < numberOfPoints; sampleIndex += 1) {
    const target = (sampleIndex / numberOfPoints) * perimeter;
    while (
      segmentIndex < segmentLengths.length - 1 &&
      segmentStartLength + segmentLengths[segmentIndex] < target
    ) {
      segmentStartLength += segmentLengths[segmentIndex];
      segmentIndex += 1;
    }
    const start = points[segmentIndex];
    const end = points[(segmentIndex + 1) % points.length];
    const segmentLength = Math.max(segmentLengths[segmentIndex], EPSILON);
    const fraction = clamp((target - segmentStartLength) / segmentLength, 0, 1);
    result.push({
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction,
    });
  }
  return result;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let output = value;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom(random: () => number): number {
  const first = Math.max(random(), Number.EPSILON);
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function periodicCatmullRom(values: number[], position: number): number {
  const count = values.length;
  const scaled = position * count;
  const index = Math.floor(scaled) % count;
  const t = scaled - Math.floor(scaled);
  const p0 = values[(index - 1 + count) % count];
  const p1 = values[index];
  const p2 = values[(index + 1) % count];
  const p3 = values[(index + 2) % count];
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
  );
}

export function generateCirclePoints(
  center: Point,
  radius: number,
  numberOfPoints: number,
  noiseLevel: number,
  seed: number,
): Point[] {
  const count = Math.max(3, Math.floor(numberOfPoints));
  const random = mulberry32(seed);
  const knotCount = Math.max(8, Math.floor(20 * noiseLevel));
  const radialKnots = Array.from({ length: knotCount }, () =>
    noiseLevel > 0 ? normalRandom(random) * 0.25 * noiseLevel : 0,
  );
  const angularKnots = Array.from({ length: knotCount }, () =>
    noiseLevel > 0 ? normalRandom(random) * 0.1 * noiseLevel : 0,
  );

  return Array.from({ length: count }, (_, index) => {
    const position = index / count;
    const baseAngle = position * Math.PI * 2;
    const perturbedRadius = Math.max(
      0,
      radius * (1 + periodicCatmullRom(radialKnots, position)),
    );
    const angle = baseAngle + periodicCatmullRom(angularKnots, position);
    return {
      x: center.x + perturbedRadius * Math.cos(angle),
      y: center.y + perturbedRadius * Math.sin(angle),
    };
  });
}

export function nearestDistances(pointsA: Point[], pointsB: Point[]): {
  aToB: number[];
  bToA: number[];
  aClosest: number[];
  bClosest: number[];
} {
  if (pointsA.length === 0 || pointsB.length === 0) {
    return {
      aToB: pointsA.map(() => Number.POSITIVE_INFINITY),
      bToA: pointsB.map(() => Number.POSITIVE_INFINITY),
      aClosest: pointsA.map(() => -1),
      bClosest: pointsB.map(() => -1),
    };
  }

  const directed = (source: Point[], target: Point[]) => {
    const distances: number[] = [];
    const closest: number[] = [];
    for (const point of source) {
      let minimumSquared = Number.POSITIVE_INFINITY;
      let minimumIndex = -1;
      for (let index = 0; index < target.length; index += 1) {
        const dx = point.x - target[index].x;
        const dy = point.y - target[index].y;
        const squared = dx * dx + dy * dy;
        if (squared < minimumSquared) {
          minimumSquared = squared;
          minimumIndex = index;
        }
      }
      distances.push(Math.sqrt(minimumSquared));
      closest.push(minimumIndex);
    }
    return { distances, closest };
  };

  const a = directed(pointsA, pointsB);
  const b = directed(pointsB, pointsA);
  return { aToB: a.distances, bToA: b.distances, aClosest: a.closest, bClosest: b.closest };
}

export function percentile(values: number[], requestedPercentile: number): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  if (finite.length === 1) return finite[0];
  const position = clamp(requestedPercentile, 0, 100) / 100 * (finite.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return finite[lower] + (finite[upper] - finite[lower]) * fraction;
}

export function addedPathLength(
  testPoints: Point[],
  testToReferenceDistances: number[],
  threshold: number,
): number {
  if (testPoints.length < 2 || testPoints.length !== testToReferenceDistances.length) return 0;
  let lengthOutside = 0;
  for (let index = 0; index < testPoints.length; index += 1) {
    const nextIndex = (index + 1) % testPoints.length;
    const segmentLength = distance(testPoints[index], testPoints[nextIndex]);
    const firstDistance = testToReferenceDistances[index];
    const secondDistance = testToReferenceDistances[nextIndex];
    const firstOutside = firstDistance > threshold;
    const secondOutside = secondDistance > threshold;
    if (firstOutside && secondOutside) {
      lengthOutside += segmentLength;
    } else if (firstOutside !== secondOutside) {
      const denominator = Math.abs(firstDistance - secondDistance);
      if (denominator > EPSILON) {
        const outsideDistance = firstOutside ? firstDistance : secondDistance;
        lengthOutside += segmentLength * clamp((outsideDistance - threshold) / denominator, 0, 1);
      }
    }
  }
  return lengthOutside;
}

export function distanceMetrics(
  pointsA: Point[],
  pointsB: Point[],
  threshold: number,
  requestedPercentile: number,
): DistanceMetrics {
  const nearest = nearestDistances(pointsA, pointsB);
  const finiteA = nearest.aToB.filter(Number.isFinite);
  const finiteB = nearest.bToA.filter(Number.isFinite);
  const meanA = finiteA.length ? finiteA.reduce((sum, value) => sum + value, 0) / finiteA.length : 0;
  const meanB = finiteB.length ? finiteB.reduce((sum, value) => sum + value, 0) / finiteB.length : 0;
  const denominator = pointsA.length + pointsB.length;
  const accepted =
    nearest.aToB.filter((value) => value <= threshold + EPSILON).length +
    nearest.bToA.filter((value) => value <= threshold + EPSILON).length;

  let maximum = 0;
  let maxPointA = pointsA[0] ?? { x: 0, y: 0 };
  let maxPointB = pointsB[0] ?? { x: 0, y: 0 };
  nearest.aToB.forEach((value, index) => {
    if (value > maximum && nearest.aClosest[index] >= 0) {
      maximum = value;
      maxPointA = pointsA[index];
      maxPointB = pointsB[nearest.aClosest[index]];
    }
  });
  nearest.bToA.forEach((value, index) => {
    if (value > maximum && nearest.bClosest[index] >= 0) {
      maximum = value;
      maxPointA = pointsA[nearest.bClosest[index]];
      maxPointB = pointsB[index];
    }
  });

  return {
    ...nearest,
    surfaceDice: denominator > 0 ? accepted / denominator : 0,
    meanSurfaceDistance: finiteA.length && finiteB.length ? (meanA + meanB) / 2 : meanA || meanB,
    hausdorffPercentile: Math.max(
      percentile(finiteA, requestedPercentile),
      percentile(finiteB, requestedPercentile),
    ),
    maximumHausdorff: maximum,
    maxPointA,
    maxPointB,
    addedPathLength: addedPathLength(pointsB, nearest.bToA, threshold),
  };
}

export function circleIntersectionArea(radiusA: number, radiusB: number, centerDistance: number): number {
  if (radiusA <= 0 || radiusB <= 0) return 0;
  if (centerDistance >= radiusA + radiusB) return 0;
  if (centerDistance <= Math.abs(radiusA - radiusB)) {
    return Math.PI * Math.min(radiusA, radiusB) ** 2;
  }
  const d2 = centerDistance * centerDistance;
  const rA2 = radiusA * radiusA;
  const rB2 = radiusB * radiusB;
  const cosineA = clamp((d2 + rA2 - rB2) / (2 * centerDistance * radiusA), -1, 1);
  const cosineB = clamp((d2 + rB2 - rA2) / (2 * centerDistance * radiusB), -1, 1);
  const angleA = 2 * Math.acos(cosineA);
  const angleB = 2 * Math.acos(cosineB);
  return (
    0.5 * rA2 * (angleA - Math.sin(angleA)) +
    0.5 * rB2 * (angleB - Math.sin(angleB))
  );
}

function analyticCircleMaskMetrics(
  centerA: Point,
  radiusA: number,
  centerB: Point,
  radiusB: number,
): MaskMetrics {
  const areaA = Math.PI * radiusA * radiusA;
  const areaB = Math.PI * radiusB * radiusB;
  const intersectionArea = circleIntersectionArea(radiusA, radiusB, distance(centerA, centerB));
  const union = areaA + areaB - intersectionArea;
  const larger = Math.max(areaA, areaB);
  return {
    dice: areaA + areaB > 0 ? (2 * intersectionArea) / (areaA + areaB) : 0,
    jaccard: union > 0 ? intersectionArea / union : 0,
    areaA,
    areaB,
    intersectionArea,
    volumeRatio: larger > 0 ? Math.min(areaA, areaB) / larger : 0,
  };
}

export function computeCircleMetrics(parameters: CircleParameters): ContourMetrics {
  const centerA = { x: parameters.circle1X, y: parameters.circle1Y };
  const centerB = { x: parameters.circle2X, y: parameters.circle2Y };
  const pointsA = generateCirclePoints(
    centerA,
    parameters.radius1,
    parameters.samplePoints,
    parameters.noise1,
    parameters.seed1,
  );
  const pointsB = generateCirclePoints(
    centerB,
    parameters.radius2,
    parameters.samplePoints,
    parameters.noise2,
    parameters.seed2,
  );
  const hasNoise = parameters.noise1 > 0 || parameters.noise2 > 0;
  let overlap: MaskMetrics;
  let overlapMethod: ContourMetrics["overlapMethod"];
  if (hasNoise) {
    const maskA = rasterisePolygon(pointsA);
    const maskB = rasterisePolygon(pointsB);
    const pixelArea = (WORLD_SPAN / MASK_SIZE) ** 2;
    overlap = metricsFromMasks(maskA, maskB, pixelArea);
    overlapMethod = "rasterised contours";
  } else {
    overlap = analyticCircleMaskMetrics(centerA, parameters.radius1, centerB, parameters.radius2);
    overlapMethod = "analytic circles";
  }
  return {
    ...overlap,
    ...distanceMetrics(pointsA, pointsB, parameters.threshold, parameters.percentile),
    centerDistance: distance(centerA, centerB),
    pointsA,
    pointsB,
    threshold: parameters.threshold,
    percentile: parameters.percentile,
    overlapMethod,
  };
}

export function computePolygonMetrics(
  polygonA: Point[],
  polygonB: Point[],
  threshold: number,
  requestedPercentile: number,
  samplePoints = 400,
): ContourMetrics {
  if (polygonA.length < 3 || polygonB.length < 3) {
    throw new Error("Both contours must contain at least three points.");
  }
  const pointsA = resampleClosedPolygon(polygonA, samplePoints);
  const pointsB = resampleClosedPolygon(polygonB, samplePoints);
  if (pointsA.length === 0 || pointsB.length === 0) {
    throw new Error("Both contours must have a non-zero perimeter.");
  }
  const maskA = rasterisePolygon(polygonA);
  const maskB = rasterisePolygon(polygonB);
  const pixelArea = (WORLD_SPAN / MASK_SIZE) ** 2;
  const centerA = polygonCentroid(polygonA);
  const centerB = polygonCentroid(polygonB);
  return {
    ...metricsFromMasks(maskA, maskB, pixelArea),
    ...distanceMetrics(pointsA, pointsB, threshold, requestedPercentile),
    centerDistance: distance(centerA, centerB),
    pointsA,
    pointsB,
    threshold,
    percentile: requestedPercentile,
    overlapMethod: "rasterised contours",
  };
}

export function transformPolygon(
  points: Point[],
  translation: Point,
  scale: number,
  rotationDegrees: number,
): Point[] {
  if (points.length === 0) return [];
  const center = polygonCentroid(points);
  const angle = (rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return points.map((point) => {
    const localX = (point.x - center.x) * scale;
    const localY = (point.y - center.y) * scale;
    return {
      x: center.x + localX * cosine - localY * sine + translation.x,
      y: center.y + localX * sine + localY * cosine + translation.y,
    };
  });
}

export function histogram(values: number[], binCount = 30): { edges: number[]; counts: number[] } {
  const finite = values.filter(Number.isFinite);
  const maximum = Math.max(1, ...finite);
  const edges = Array.from({ length: binCount + 1 }, (_, index) => (index / binCount) * maximum);
  const counts = Array.from({ length: binCount }, () => 0);
  finite.forEach((value) => {
    const index = Math.min(binCount - 1, Math.floor((value / maximum) * binCount));
    counts[index] += 1;
  });
  return { edges, counts };
}

export function metricsText(metrics: ContourMetrics, unit = "mm"): string {
  return `2D OVERLAP METRICS (${metrics.overlapMethod})
------------------------------------------------------------------
DICE Coefficient:           ${metrics.dice.toFixed(4)}  (0-1, higher = better overlap)
Jaccard Index:              ${metrics.jaccard.toFixed(4)}  (intersection / union)
Area Ratio:                 ${metrics.volumeRatio.toFixed(4)}  (size similarity)

SURFACE-BASED METRICS (arc-length resampled points)
------------------------------------------------------------------
Surface DICE:               ${metrics.surfaceDice.toFixed(4)}  (agreement @ ${metrics.threshold.toFixed(1)} ${unit})
Mean Surface Distance:      ${metrics.meanSurfaceDistance.toFixed(3)} ${unit}
${metrics.percentile.toFixed(1)}th Percentile HD:       ${metrics.hausdorffPercentile.toFixed(3)} ${unit}
Maximum Hausdorff:          ${metrics.maximumHausdorff.toFixed(3)} ${unit}

GEOMETRIC PROPERTIES
------------------------------------------------------------------
Reference Area:             ${metrics.areaA.toFixed(2)} ${unit}²
Test Area:                  ${metrics.areaB.toFixed(2)} ${unit}²
Intersection Area:          ${metrics.intersectionArea.toFixed(2)} ${unit}²
Center-to-Center Distance:  ${metrics.centerDistance.toFixed(3)} ${unit}
Added Path Length (APL):    ${metrics.addedPathLength.toFixed(2)} ${unit}

EDUCATIONAL INTERPRETATION ONLY
Thresholds and acceptable values are anatomy-, task-, resolution-, and institution-dependent.`;
}
