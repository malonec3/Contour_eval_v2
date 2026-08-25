import assert from "node:assert/strict";
import test from "node:test";
import {
  addedPathLength,
  circleIntersectionArea,
  computeCircleMetrics,
  computePolygonMetrics,
  metricsFromPolygons,
  nearestDistances,
  percentile,
  polygonArea,
  polygonIntersectionArea,
  polygonSelfIntersects,
  transformPolygon,
  type CircleParameters,
  type Point,
} from "../app/lib/metrics.ts";

const defaults: CircleParameters = {
  circle1X: 0,
  circle1Y: 0,
  radius1: 3,
  noise1: 0,
  circle2X: 0,
  circle2Y: 0,
  radius2: 3,
  noise2: 0,
  threshold: 0.1,
  percentile: 95,
  samplePoints: 360,
  seed1: 1,
  seed2: 2,
};

const square: Point[] = [
  { x: -2, y: -2 },
  { x: 2, y: -2 },
  { x: 2, y: 2 },
  { x: -2, y: 2 },
];

function near(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`);
}

test("circle intersection handles identical, disjoint, and contained circles", () => {
  near(circleIntersectionArea(3, 3, 0), Math.PI * 9);
  near(circleIntersectionArea(3, 3, 6), 0);
  near(circleIntersectionArea(5, 2, 1), Math.PI * 4);
});

test("identical circles produce perfect overlap and zero surface distances", () => {
  const metrics = computeCircleMetrics(defaults);
  near(metrics.dice, 1);
  near(metrics.jaccard, 1);
  near(metrics.surfaceDice, 1);
  near(metrics.meanSurfaceDistance, 0, 1e-12);
  near(metrics.hausdorffPercentile, 0, 1e-12);
  near(metrics.maximumHausdorff, 0, 1e-12);
  near(metrics.addedPathLength, 0, 1e-12);
});

test("concentric unequal circles match analytic overlap identities", () => {
  const metrics = computeCircleMetrics({ ...defaults, radius1: 3, radius2: 4, threshold: 1 });
  near(metrics.dice, 18 / 25);
  near(metrics.jaccard, 9 / 16);
  near(metrics.jaccard, metrics.dice / (2 - metrics.dice));
  near(metrics.meanSurfaceDistance, 1, 2e-5);
  near(metrics.hausdorffPercentile, 1, 1e-10);
  near(metrics.maximumHausdorff, 1, 1e-10);
  near(metrics.surfaceDice, 1, 1e-10);
  near(metrics.addedPathLength, 0, 1e-12);
  near(metrics.testExcessPathLength, 0, 1e-12);
});

test("identical drawn polygons remain identical after arc-length resampling", () => {
  const metrics = computePolygonMetrics(square, square, 0.1, 95, 256);
  near(metrics.dice, 1);
  near(metrics.jaccard, 1);
  near(metrics.surfaceDice, 1);
  near(metrics.maximumHausdorff, 0, 1e-12);
});

test("rigid transforms preserve area and uniform scaling changes it quadratically", () => {
  const moved = transformPolygon(square, { x: 3, y: -4 }, 1, 37);
  const scaled = transformPolygon(square, { x: 0, y: 0 }, 2, 0);
  near(polygonArea(moved), polygonArea(square), 1e-10);
  near(polygonArea(scaled), polygonArea(square) * 4, 1e-10);
});

test("added path length includes wrap-around and interpolates threshold crossings", () => {
  const path: Point[] = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];
  near(addedPathLength(path, [2, 0, 0, 2], 1), 4, 1e-8);
});

test("percentiles use stable linear interpolation", () => {
  near(percentile([0, 10, 20, 30], 50), 15);
  near(percentile([30, 0, 20, 10], 95), 28.5);
});

test("surface Dice and mean surface distance are weighted by contour arc length", () => {
  const reference: Point[] = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ];
  const testContour: Point[] = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 }, { x: 0, y: 1 },
  ];
  const metrics = computePolygonMetrics(reference, testContour, 0, 95, 1040);

  near(metrics.surfaceDice, 6 / 26, 1e-3);
  near(metrics.meanSurfaceDistance, 90.25 / 26, 5e-5);
});

test("APL measures the ground-truth path to add to the test and reports test excess separately", () => {
  const reference: Point[] = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ];
  const testContour: Point[] = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 }, { x: 0, y: 1 },
  ];
  const metrics = computePolygonMetrics(reference, testContour, 0, 95, 1040);

  near(metrics.addedPathLength, 1, 1e-7);
  near(metrics.testExcessPathLength, 19, 0.02);
  near(metrics.bidirectionalPathLength, 20, 0.02);
});

test("polygon overlap is position-independent rather than pixel-grid dependent", () => {
  const shifted = square.map((point) => ({ x: point.x + 0.01, y: point.y }));
  const metrics = metricsFromPolygons(square, shifted);
  near(metrics.areaA, 16);
  near(metrics.areaB, 16);
  near(metrics.intersectionArea, 15.96, 1e-10);
  near(metrics.dice, 0.9975, 1e-10);
});

test("concave simple polygons use exact polygon intersection geometry", () => {
  const concave: Point[] = [
    { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 },
    { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 3 },
  ];
  const rectangle: Point[] = [
    { x: 0.5, y: 0.5 }, { x: 2.5, y: 0.5 },
    { x: 2.5, y: 2.5 }, { x: 0.5, y: 2.5 },
  ];
  near(polygonIntersectionArea(concave, rectangle), 1.75, 1e-10);
});

test("metrics use full contours beyond the visible coordinate window", () => {
  const outside = square.map((point) => ({ x: point.x + 10, y: point.y }));
  const metrics = computePolygonMetrics(outside, outside, 0.1, 95, 128);
  near(metrics.areaA, 16);
  near(metrics.dice, 1);
  assert.equal(metrics.outOfBoundsA, true);
  assert.equal(metrics.outOfBoundsB, true);
});

test("clean and noisy synthetic contours use the same polygon calculation path", () => {
  const clean = computeCircleMetrics(defaults);
  const barelyNoisy = computeCircleMetrics({ ...defaults, noise1: 0.000001 });
  assert.equal(clean.overlapMethod, "polygon geometry");
  assert.equal(barelyNoisy.overlapMethod, "polygon geometry");
  assert.ok(Math.abs(clean.dice - barelyNoisy.dice) < 0.00001);
});

test("surface distances project onto target segments rather than target vertices", () => {
  const result = nearestDistances(
    [{ x: 0.25, y: 0.5 }],
    [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  );
  near(result.aToB[0], 0.25, 1e-12);
  near(result.aClosestPoints[0].x, 0, 1e-12);
  near(result.aClosestPoints[0].y, 0.5, 1e-12);
});

test("self-intersecting contours are rejected instead of producing ambiguous areas", () => {
  const bowTie: Point[] = [
    { x: -1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 },
  ];
  assert.equal(polygonSelfIntersects(bowTie), true);
  assert.throws(() => computePolygonMetrics(bowTie, square, 1, 95), /self-intersections/);
});
