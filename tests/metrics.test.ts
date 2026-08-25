import assert from "node:assert/strict";
import test from "node:test";
import {
  addedPathLength,
  circleIntersectionArea,
  computeCircleMetrics,
  computePolygonMetrics,
  percentile,
  polygonArea,
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
  near(metrics.meanSurfaceDistance, 1, 1e-10);
  near(metrics.hausdorffPercentile, 1, 1e-10);
  near(metrics.maximumHausdorff, 1, 1e-10);
  near(metrics.surfaceDice, 1, 1e-10);
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
  near(addedPathLength(path, [2, 0, 0, 2], 1), 4);
});

test("percentiles use stable linear interpolation", () => {
  near(percentile([0, 10, 20, 30], 50), 15);
  near(percentile([30, 0, 20, 10], 95), 28.5);
});
