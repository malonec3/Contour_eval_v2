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
  aClosestPoints: Point[];
  bClosestPoints: Point[];
  surfaceDice: number;
  meanSurfaceDistance: number;
  hausdorffPercentile: number;
  maximumHausdorff: number;
  maxPointA: Point;
  maxPointB: Point;
  /** Literature-style APL: ground-truth boundary path that must be added to the test contour. */
  addedPathLength: number;
  /** Test boundary lying beyond tolerance from the reference contour. */
  testExcessPathLength: number;
  /** Sum of the two directional out-of-tolerance path lengths. */
  bidirectionalPathLength: number;
};

export type ContourMetrics = MaskMetrics &
  DistanceMetrics & {
    centerDistance: number;
    pointsA: Point[];
    pointsB: Point[];
    threshold: number;
    percentile: number;
    overlapMethod: "polygon geometry";
    outOfBoundsA: boolean;
    outOfBoundsB: boolean;
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
const OVERLAP_SAMPLE_POINTS = 360;

const EPSILON = 1e-9;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function signedPolygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

export function polygonArea(points: Point[]): number {
  return Math.abs(signedPolygonArea(points));
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function samePoint(a: Point, b: Point): boolean {
  return distance(a, b) <= EPSILON;
}

function sanitisePolygon(points: Point[]): Point[] {
  const cleaned: Point[] = [];
  for (const point of points) {
    if (cleaned.length === 0 || !samePoint(cleaned[cleaned.length - 1], point)) cleaned.push(point);
  }
  if (cleaned.length > 1 && samePoint(cleaned[0], cleaned[cleaned.length - 1])) cleaned.pop();

  let changed = true;
  while (changed && cleaned.length >= 3) {
    changed = false;
    for (let index = 0; index < cleaned.length; index += 1) {
      const previous = cleaned[(index - 1 + cleaned.length) % cleaned.length];
      const current = cleaned[index];
      const next = cleaned[(index + 1) % cleaned.length];
      if (Math.abs(cross(previous, current, next)) <= EPSILON) {
        cleaned.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return cleaned;
}

function within(value: number, first: number, second: number): boolean {
  return value >= Math.min(first, second) - EPSILON && value <= Math.max(first, second) + EPSILON;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  ) return true;
  if (Math.abs(abC) <= EPSILON && within(c.x, a.x, b.x) && within(c.y, a.y, b.y)) return true;
  if (Math.abs(abD) <= EPSILON && within(d.x, a.x, b.x) && within(d.y, a.y, b.y)) return true;
  if (Math.abs(cdA) <= EPSILON && within(a.x, c.x, d.x) && within(a.y, c.y, d.y)) return true;
  if (Math.abs(cdB) <= EPSILON && within(b.x, c.x, d.x) && within(b.y, c.y, d.y)) return true;
  return false;
}

export function polygonSelfIntersects(points: Point[]): boolean {
  const polygon = sanitisePolygon(points);
  const count = polygon.length;
  if (count < 3) return false;
  for (let first = 0; first < count; first += 1) {
    const firstNext = (first + 1) % count;
    for (let second = first + 1; second < count; second += 1) {
      const secondNext = (second + 1) % count;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(polygon[first], polygon[firstNext], polygon[second], polygon[secondNext])) return true;
    }
  }
  return false;
}

function pointInTriangle(point: Point, a: Point, b: Point, c: Point): boolean {
  return cross(a, b, point) >= -EPSILON && cross(b, c, point) >= -EPSILON && cross(c, a, point) >= -EPSILON;
}

function triangulatePolygon(points: Point[]): Point[][] | null {
  let polygon = sanitisePolygon(points);
  if (polygon.length < 3 || polygonArea(polygon) <= EPSILON || polygonSelfIntersects(polygon)) return null;
  if (signedPolygonArea(polygon) < 0) polygon = [...polygon].reverse();
  const indices = polygon.map((_, index) => index);
  const triangles: Point[][] = [];
  let guard = polygon.length * polygon.length;

  while (indices.length > 3 && guard > 0) {
    let earFound = false;
    for (let position = 0; position < indices.length; position += 1) {
      const previousIndex = indices[(position - 1 + indices.length) % indices.length];
      const currentIndex = indices[position];
      const nextIndex = indices[(position + 1) % indices.length];
      const a = polygon[previousIndex];
      const b = polygon[currentIndex];
      const c = polygon[nextIndex];
      if (cross(a, b, c) <= EPSILON) continue;
      const containsVertex = indices.some((candidate) =>
        candidate !== previousIndex && candidate !== currentIndex && candidate !== nextIndex &&
        pointInTriangle(polygon[candidate], a, b, c));
      if (containsVertex) continue;
      triangles.push([a, b, c]);
      indices.splice(position, 1);
      earFound = true;
      break;
    }
    if (!earFound) return null;
    guard -= 1;
  }
  if (indices.length === 3) triangles.push(indices.map((index) => polygon[index]));
  return triangles;
}

function lineIntersection(start: Point, end: Point, clipStart: Point, clipEnd: Point): Point {
  const segment = { x: end.x - start.x, y: end.y - start.y };
  const clip = { x: clipEnd.x - clipStart.x, y: clipEnd.y - clipStart.y };
  const denominator = segment.x * clip.y - segment.y * clip.x;
  if (Math.abs(denominator) <= EPSILON) return end;
  const offset = { x: clipStart.x - start.x, y: clipStart.y - start.y };
  const fraction = (offset.x * clip.y - offset.y * clip.x) / denominator;
  return { x: start.x + segment.x * fraction, y: start.y + segment.y * fraction };
}

function intersectConvexPolygons(subject: Point[], clipPolygon: Point[]): Point[] {
  let output = subject;
  for (let edge = 0; edge < clipPolygon.length && output.length > 0; edge += 1) {
    const clipStart = clipPolygon[edge];
    const clipEnd = clipPolygon[(edge + 1) % clipPolygon.length];
    const input = output;
    output = [];
    let previous = input[input.length - 1];
    let previousInside = cross(clipStart, clipEnd, previous) >= -EPSILON;
    for (const current of input) {
      const currentInside = cross(clipStart, clipEnd, current) >= -EPSILON;
      if (currentInside !== previousInside) output.push(lineIntersection(previous, current, clipStart, clipEnd));
      if (currentInside) output.push(current);
      previous = current;
      previousInside = currentInside;
    }
  }
  return output;
}

function boundsOverlap(first: Point[], second: Point[]): boolean {
  const firstX = first.map((point) => point.x);
  const firstY = first.map((point) => point.y);
  const secondX = second.map((point) => point.x);
  const secondY = second.map((point) => point.y);
  return !(
    Math.max(...firstX) < Math.min(...secondX) - EPSILON ||
    Math.max(...secondX) < Math.min(...firstX) - EPSILON ||
    Math.max(...firstY) < Math.min(...secondY) - EPSILON ||
    Math.max(...secondY) < Math.min(...firstY) - EPSILON
  );
}

export function polygonIntersectionArea(pointsA: Point[], pointsB: Point[]): number {
  const areaA = polygonArea(pointsA);
  const areaB = polygonArea(pointsB);
  if (areaA <= EPSILON || areaB <= EPSILON) return 0;
  if (!boundsOverlap(pointsA, pointsB)) return 0;
  const trianglesA = triangulatePolygon(pointsA);
  const trianglesB = triangulatePolygon(pointsB);
  if (!trianglesA || !trianglesB) {
    throw new Error("Contours must be simple closed loops without self-intersections.");
  }
  let intersection = 0;
  for (const triangleA of trianglesA) {
    for (const triangleB of trianglesB) {
      if (!boundsOverlap(triangleA, triangleB)) continue;
      intersection += polygonArea(intersectConvexPolygons(triangleA, triangleB));
    }
  }
  return clamp(intersection, 0, Math.min(areaA, areaB));
}

export function metricsFromPolygons(pointsA: Point[], pointsB: Point[]): MaskMetrics {
  const areaA = polygonArea(pointsA);
  const areaB = polygonArea(pointsB);
  const intersectionArea = polygonIntersectionArea(pointsA, pointsB);
  const union = areaA + areaB - intersectionArea;
  const larger = Math.max(areaA, areaB);
  return {
    dice: areaA + areaB > EPSILON ? (2 * intersectionArea) / (areaA + areaB) : 0,
    jaccard: union > EPSILON ? intersectionArea / union : 0,
    areaA,
    areaB,
    intersectionArea,
    volumeRatio: larger > EPSILON ? Math.min(areaA, areaB) / larger : 0,
  };
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

export function resampleClosedPolygon(
  points: Point[],
  numberOfPoints = 400,
  retainVertices = true,
): Point[] {
  if (points.length < 2 || numberOfPoints <= 0) return [];
  const segmentLengths: number[] = [];
  const segmentStarts: number[] = [];
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    segmentStarts.push(perimeter);
    const length = distance(points[index], points[(index + 1) % points.length]);
    segmentLengths.push(length);
    perimeter += length;
  }
  if (perimeter < EPSILON) return [];

  // Uniform samples make point density independent of how a contour was drawn. Keeping every
  // original vertex as well prevents the resampled polyline from cutting across sharp corners.
  const positions = [
    ...Array.from({ length: Math.max(3, Math.floor(numberOfPoints)) }, (_, index) =>
      (index / Math.max(3, Math.floor(numberOfPoints))) * perimeter),
    ...(retainVertices ? segmentStarts : []),
  ].sort((a, b) => a - b).filter((value, index, values) =>
    index === 0 || value - values[index - 1] > EPSILON);

  const result: Point[] = [];
  let segmentIndex = 0;
  let segmentStartLength = 0;
  for (const target of positions) {
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

  return Array.from({ length: count }, (_, index) => {
    const position = index / count;
    const angle = position * Math.PI * 2;
    const perturbedRadius = Math.max(
      0,
      radius * (1 + periodicCatmullRom(radialKnots, position)),
    );
    return {
      x: center.x + perturbedRadius * Math.cos(angle),
      y: center.y + perturbedRadius * Math.sin(angle),
    };
  });
}

function directedNearestDistances(source: Point[], target: Point[]): {
  distances: number[];
  closest: number[];
  closestPoints: Point[];
} {
  if (source.length === 0 || target.length === 0) {
    return {
      distances: source.map(() => Number.POSITIVE_INFINITY),
      closest: source.map(() => -1),
      closestPoints: source.map(() => ({ x: Number.NaN, y: Number.NaN })),
    };
  }

  const closestPointOnSegment = (point: Point, start: Point, end: Point): { point: Point; squared: number } => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared > EPSILON
      ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
      : 0;
    const closestPoint = { x: start.x + fraction * dx, y: start.y + fraction * dy };
    const offsetX = point.x - closestPoint.x;
    const offsetY = point.y - closestPoint.y;
    return { point: closestPoint, squared: offsetX * offsetX + offsetY * offsetY };
  };

  const distances: number[] = [];
  const closest: number[] = [];
  const closestPoints: Point[] = [];
  for (const point of source) {
    let minimumSquared = Number.POSITIVE_INFINITY;
    let minimumIndex = -1;
    let minimumPoint = target[0];
    for (let index = 0; index < target.length; index += 1) {
      const projection = closestPointOnSegment(point, target[index], target[(index + 1) % target.length]);
      if (projection.squared < minimumSquared) {
        minimumSquared = projection.squared;
        minimumIndex = index;
        minimumPoint = projection.point;
      }
    }
    distances.push(Math.sqrt(minimumSquared));
    closest.push(minimumIndex);
    closestPoints.push(minimumPoint);
  }
  return { distances, closest, closestPoints };
}

export function nearestDistances(pointsA: Point[], pointsB: Point[]): {
  aToB: number[];
  bToA: number[];
  aClosest: number[];
  bClosest: number[];
  aClosestPoints: Point[];
  bClosestPoints: Point[];
} {
  const a = directedNearestDistances(pointsA, pointsB);
  const b = directedNearestDistances(pointsB, pointsA);
  return {
    aToB: a.distances,
    bToA: b.distances,
    aClosest: a.closest,
    bClosest: b.closest,
    aClosestPoints: a.closestPoints,
    bClosestPoints: b.closestPoints,
  };
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
  contourPoints: Point[],
  distancesToOtherContour: number[],
  threshold: number,
): number {
  if (contourPoints.length < 2 || contourPoints.length !== distancesToOtherContour.length) return 0;
  const cutoff = Math.max(0, threshold) + EPSILON;
  let lengthOutside = 0;
  for (let index = 0; index < contourPoints.length; index += 1) {
    const nextIndex = (index + 1) % contourPoints.length;
    const segmentLength = distance(contourPoints[index], contourPoints[nextIndex]);
    const firstDistance = distancesToOtherContour[index];
    const secondDistance = distancesToOtherContour[nextIndex];
    const firstOutside = firstDistance > cutoff;
    const secondOutside = secondDistance > cutoff;
    if (firstOutside && secondOutside) {
      lengthOutside += segmentLength;
    } else if (firstOutside !== secondOutside) {
      const denominator = Math.abs(firstDistance - secondDistance);
      if (denominator > EPSILON) {
        const outsideDistance = firstOutside ? firstDistance : secondDistance;
        lengthOutside += segmentLength * clamp((outsideDistance - cutoff) / denominator, 0, 1);
      }
    }
  }
  return lengthOutside;
}

export function arcLength(points: Point[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    total += distance(points[index], points[(index + 1) % points.length]);
  }
  return total;
}

function integratedDistance(points: Point[], values: number[]): number {
  if (points.length < 2 || points.length !== values.length) return 0;
  let integral = 0;
  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    if (!Number.isFinite(values[index]) || !Number.isFinite(values[nextIndex])) continue;
    integral += distance(points[index], points[nextIndex]) * (values[index] + values[nextIndex]) / 2;
  }
  return integral;
}

export function distanceMetrics(
  pointsA: Point[],
  pointsB: Point[],
  threshold: number,
  requestedPercentile: number,
  geometryA = pointsA,
  geometryB = pointsB,
): DistanceMetrics {
  const directedA = directedNearestDistances(pointsA, geometryB);
  const directedB = directedNearestDistances(pointsB, geometryA);
  const nearest = {
    aToB: directedA.distances,
    bToA: directedB.distances,
    aClosest: directedA.closest,
    bClosest: directedB.closest,
    aClosestPoints: directedA.closestPoints,
    bClosestPoints: directedB.closestPoints,
  };
  const finiteA = nearest.aToB.filter(Number.isFinite);
  const finiteB = nearest.bToA.filter(Number.isFinite);
  const perimeterA = arcLength(pointsA);
  const perimeterB = arcLength(pointsB);
  const totalPerimeter = perimeterA + perimeterB;
  const referenceAddedPath = addedPathLength(pointsA, nearest.aToB, threshold);
  const testExcessPath = addedPathLength(pointsB, nearest.bToA, threshold);
  const acceptedLength = Math.max(0, perimeterA - referenceAddedPath) + Math.max(0, perimeterB - testExcessPath);
  const fallbackValues = [...finiteA, ...finiteB];
  const fallbackMean = fallbackValues.length
    ? fallbackValues.reduce((sum, value) => sum + value, 0) / fallbackValues.length
    : 0;

  let maximum = 0;
  let maxPointA = pointsA[0] ?? { x: 0, y: 0 };
  let maxPointB = pointsB[0] ?? { x: 0, y: 0 };
  nearest.aToB.forEach((value, index) => {
    if (value > maximum && nearest.aClosest[index] >= 0) {
      maximum = value;
      maxPointA = pointsA[index];
      maxPointB = nearest.aClosestPoints[index];
    }
  });
  nearest.bToA.forEach((value, index) => {
    if (value > maximum && nearest.bClosest[index] >= 0) {
      maximum = value;
      maxPointA = nearest.bClosestPoints[index];
      maxPointB = pointsB[index];
    }
  });

  return {
    ...nearest,
    surfaceDice: totalPerimeter > EPSILON
      ? acceptedLength / totalPerimeter
      : fallbackValues.length > 0 && fallbackValues.every((value) => value <= threshold + EPSILON) ? 1 : 0,
    meanSurfaceDistance: totalPerimeter > EPSILON
      ? (integratedDistance(pointsA, nearest.aToB) + integratedDistance(pointsB, nearest.bToA)) / totalPerimeter
      : fallbackMean,
    hausdorffPercentile: Math.max(
      percentile(finiteA, requestedPercentile),
      percentile(finiteB, requestedPercentile),
    ),
    maximumHausdorff: maximum,
    maxPointA,
    maxPointB,
    addedPathLength: referenceAddedPath,
    testExcessPathLength: testExcessPath,
    bidirectionalPathLength: referenceAddedPath + testExcessPath,
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

function sampledContour(points: Point[], samplePoints: number): Point[] {
  const sampled = resampleClosedPolygon(points, samplePoints, false);
  return sampled.length > 0 ? sampled : points.slice(0, 1);
}

export function contourOutsideWorld(points: Point[]): boolean {
  return points.some((point) =>
    point.x < WORLD_MIN - EPSILON || point.x > WORLD_MAX + EPSILON ||
    point.y < WORLD_MIN - EPSILON || point.y > WORLD_MAX + EPSILON);
}

export function computeCircleMetrics(parameters: CircleParameters): ContourMetrics {
  const centerA = { x: parameters.circle1X, y: parameters.circle1Y };
  const centerB = { x: parameters.circle2X, y: parameters.circle2Y };
  const shapeA = generateCirclePoints(
    centerA,
    parameters.radius1,
    OVERLAP_SAMPLE_POINTS,
    parameters.noise1,
    parameters.seed1,
  );
  const shapeB = generateCirclePoints(
    centerB,
    parameters.radius2,
    OVERLAP_SAMPLE_POINTS,
    parameters.noise2,
    parameters.seed2,
  );
  const pointsA = sampledContour(shapeA, parameters.samplePoints);
  const pointsB = sampledContour(shapeB, parameters.samplePoints);
  return {
    ...metricsFromPolygons(shapeA, shapeB),
    ...distanceMetrics(pointsA, pointsB, parameters.threshold, parameters.percentile, shapeA, shapeB),
    centerDistance: distance(centerA, centerB),
    pointsA,
    pointsB,
    threshold: parameters.threshold,
    percentile: parameters.percentile,
    overlapMethod: "polygon geometry",
    outOfBoundsA: contourOutsideWorld(shapeA),
    outOfBoundsB: contourOutsideWorld(shapeB),
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
  if (polygonSelfIntersects(polygonA) || polygonSelfIntersects(polygonB)) {
    throw new Error("Contours must be simple closed loops without self-intersections.");
  }
  const pointsA = resampleClosedPolygon(polygonA, samplePoints);
  const pointsB = resampleClosedPolygon(polygonB, samplePoints);
  if (pointsA.length === 0 || pointsB.length === 0) {
    throw new Error("Both contours must have a non-zero perimeter.");
  }
  const centerA = polygonCentroid(polygonA);
  const centerB = polygonCentroid(polygonB);
  return {
    ...metricsFromPolygons(polygonA, polygonB),
    ...distanceMetrics(pointsA, pointsB, threshold, requestedPercentile, polygonA, polygonB),
    centerDistance: distance(centerA, centerB),
    pointsA,
    pointsB,
    threshold,
    percentile: requestedPercentile,
    overlapMethod: "polygon geometry",
    outOfBoundsA: contourOutsideWorld(polygonA),
    outOfBoundsB: contourOutsideWorld(polygonB),
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

SURFACE-BASED METRICS (arc-length weighted; point-to-segment distances)
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
APL (path to add to test):  ${metrics.addedPathLength.toFixed(2)} ${unit}
Test excess path (B→A):     ${metrics.testExcessPathLength.toFixed(2)} ${unit}
Bidirectional edit path:    ${metrics.bidirectionalPathLength.toFixed(2)} ${unit}

EDUCATIONAL INTERPRETATION ONLY
Thresholds and acceptable values are anatomy-, task-, resolution-, and institution-dependent.`;
}
