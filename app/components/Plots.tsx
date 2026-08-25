"use client";

import type { ContourMetrics, Point } from "../lib/metrics";
import { histogram, WORLD_MAX, WORLD_MIN } from "../lib/metrics";

type PlotKind = "surface" | "acceptance" | "overlap" | "heat" | "apl";

type ContourPlotProps = {
  metrics: ContourMetrics;
  kind: PlotKind;
  title: string;
  unit: string;
};

const VIEW = 420;
const LEFT = 46;
const TOP = 28;
const PLOT = 326;

function xPixel(x: number): number {
  return LEFT + ((x - WORLD_MIN) / (WORLD_MAX - WORLD_MIN)) * PLOT;
}

function yPixel(y: number): number {
  return TOP + ((WORLD_MAX - y) / (WORLD_MAX - WORLD_MIN)) * PLOT;
}

function pathFor(points: Point[]): string {
  if (points.length === 0) return "";
  return `${points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xPixel(point.x).toFixed(2)},${yPixel(point.y).toFixed(2)}`)
    .join(" ")} Z`;
}

type ClassifiedSegment = {
  start: Point;
  end: Point;
  accepted: boolean;
};

function classifyContourSegments(
  points: Point[],
  distances: number[],
  threshold: number,
): ClassifiedSegment[] {
  if (points.length < 2 || distances.length !== points.length) return [];
  const cutoff = threshold + 1e-9;
  const segments: ClassifiedSegment[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const nextIndex = (index + 1) % points.length;
    const start = points[index];
    const end = points[nextIndex];
    const startDistance = distances[index];
    const endDistance = distances[nextIndex];
    const startAccepted = startDistance <= cutoff;
    const endAccepted = endDistance <= cutoff;

    if (startAccepted === endAccepted || Math.abs(endDistance - startDistance) <= 1e-12) {
      segments.push({ start, end, accepted: startAccepted });
      continue;
    }

    const fraction = Math.min(1, Math.max(0, (cutoff - startDistance) / (endDistance - startDistance)));
    const crossing = {
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction,
    };
    segments.push({ start, end: crossing, accepted: startAccepted });
    segments.push({ start: crossing, end, accepted: endAccepted });
  }
  return segments;
}

function ToleranceContour({
  points,
  distances,
  threshold,
  prefix,
  opacity = 0.92,
}: {
  points: Point[];
  distances: number[];
  threshold: number;
  prefix: string;
  opacity?: number;
}) {
  return (
    <>
      {classifyContourSegments(points, distances, threshold).map((segment, index) => (
        <line
          key={`${prefix}-${index}`}
          x1={xPixel(segment.start.x)}
          y1={yPixel(segment.start.y)}
          x2={xPixel(segment.end.x)}
          y2={yPixel(segment.end.y)}
          stroke={segment.accepted ? "#138a5b" : "#f29a38"}
          strokeWidth="3.8"
          strokeLinecap="round"
          opacity={opacity}
        />
      ))}
    </>
  );
}

function heatColor(value: number, maximum: number): string {
  const fraction = maximum > 0 ? Math.min(1, value / maximum) : 0;
  const hue = 176 - fraction * 176;
  return `hsl(${hue} 72% ${42 + fraction * 7}%)`;
}

function PlotFrame({ children, unit }: { children: React.ReactNode; unit: string }) {
  const ticks = [-10, -5, 0, 5, 10];
  return (
    <>
      <rect x={LEFT} y={TOP} width={PLOT} height={PLOT} rx="8" className="plot-background" />
      {ticks.map((tick) => (
        <g key={`grid-${tick}`}>
          <line x1={xPixel(tick)} y1={TOP} x2={xPixel(tick)} y2={TOP + PLOT} className="plot-gridline" />
          <line x1={LEFT} y1={yPixel(tick)} x2={LEFT + PLOT} y2={yPixel(tick)} className="plot-gridline" />
          <text x={xPixel(tick)} y={TOP + PLOT + 20} textAnchor="middle" className="plot-tick">
            {tick}
          </text>
          <text x={LEFT - 10} y={yPixel(tick) + 4} textAnchor="end" className="plot-tick">
            {tick}
          </text>
        </g>
      ))}
      {children}
      <text x={LEFT + PLOT / 2} y={VIEW - 8} textAnchor="middle" className="plot-label">
        X ({unit})
      </text>
      <text
        x="13"
        y={TOP + PLOT / 2}
        textAnchor="middle"
        className="plot-label"
        transform={`rotate(-90 13 ${TOP + PLOT / 2})`}
      >
        Y ({unit})
      </text>
    </>
  );
}

function Legend({ items }: { items: Array<{ color: string; label: string; dashed?: boolean }> }) {
  return (
    <div className="plot-legend" aria-label="Plot legend">
      {items.map((item) => (
        <span key={item.label}>
          <i style={{ background: item.color, borderStyle: item.dashed ? "dashed" : "solid" }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ContourPlot({ metrics, kind, title, unit }: ContourPlotProps) {
  const heatPointRadius = metrics.pointsA.length > 250 ? 1.55 : 2.1;
  const maximumDistance = Math.max(metrics.maximumHausdorff, metrics.threshold, 0.01);
  const thresholdStroke = Math.max(3, (metrics.threshold / (WORLD_MAX - WORLD_MIN)) * PLOT * 2);
  const isSurface = kind === "surface";
  const isAcceptance = kind === "acceptance";
  const isOverlap = kind === "overlap";
  const isHeat = kind === "heat";
  const isApl = kind === "apl";

  return (
    <article className="plot-card">
      <div className="plot-card-heading">
        <h3>{title}</h3>
        {isOverlap && <strong>DICE {metrics.dice.toFixed(3)}</strong>}
        {isApl && <strong>APL {metrics.addedPathLength.toFixed(2)} {unit}</strong>}
      </div>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label={title} className="metric-plot">
        <PlotFrame unit={unit}>
          {isAcceptance && (
            <path
              d={pathFor(metrics.pointsA)}
              fill="none"
              stroke="#49b884"
              strokeWidth={thresholdStroke}
              strokeOpacity="0.2"
              strokeLinejoin="round"
            />
          )}

          {isOverlap ? (
            <>
              <path d={pathFor(metrics.pointsA)} fill="#2268c7" fillOpacity="0.28" stroke="#1855a5" strokeWidth="1.7" />
              <path d={pathFor(metrics.pointsB)} fill="#ea5b61" fillOpacity="0.30" stroke="#c43e48" strokeWidth="1.7" />
            </>
          ) : isAcceptance ? (
            <path d={pathFor(metrics.pointsA)} fill="none" stroke="#2268c7" strokeWidth="1.8" />
          ) : isHeat ? (
            <>
              <path d={pathFor(metrics.pointsA)} fill="none" stroke="#2268c7" strokeWidth="1.6" />
              <path d={pathFor(metrics.pointsB)} fill="none" stroke="#df4f58" strokeWidth="1.6" />
            </>
          ) : null}

          {(isSurface || isAcceptance) && (
            <ToleranceContour
              points={metrics.pointsB}
              distances={metrics.bToA}
              threshold={metrics.threshold}
              prefix="test-tolerance"
            />
          )}

          {isSurface && (
            <ToleranceContour
              points={metrics.pointsA}
              distances={metrics.aToB}
              threshold={metrics.threshold}
              prefix="reference-tolerance"
              opacity={0.82}
            />
          )}

          {isApl && (
            <ToleranceContour
              points={metrics.pointsA}
              distances={metrics.aToB}
              threshold={metrics.threshold}
              prefix="apl-reference-path"
            />
          )}

          {isHeat && (
            <>
              {metrics.pointsA.map((point, index) => (
                <circle
                  key={`heat-a-${index}`}
                  cx={xPixel(point.x)}
                  cy={yPixel(point.y)}
                  r={heatPointRadius + 0.4}
                  fill={heatColor(metrics.aToB[index], maximumDistance)}
                />
              ))}
              {metrics.pointsB.map((point, index) => (
                <rect
                  key={`heat-b-${index}`}
                  x={xPixel(point.x) - heatPointRadius}
                  y={yPixel(point.y) - heatPointRadius}
                  width={heatPointRadius * 2}
                  height={heatPointRadius * 2}
                  fill={heatColor(metrics.bToA[index], maximumDistance)}
                />
              ))}
            </>
          )}

          {isSurface && metrics.maximumHausdorff > 0 && (
            <>
              <line
                x1={xPixel(metrics.maxPointA.x)}
                y1={yPixel(metrics.maxPointA.y)}
                x2={xPixel(metrics.maxPointB.x)}
                y2={yPixel(metrics.maxPointB.y)}
                stroke="#17233a"
                strokeWidth="1.6"
                strokeDasharray="5 4"
              />
              <circle cx={xPixel(metrics.maxPointA.x)} cy={yPixel(metrics.maxPointA.y)} r="3" fill="#17233a" />
              <circle cx={xPixel(metrics.maxPointB.x)} cy={yPixel(metrics.maxPointB.y)} r="3" fill="#17233a" />
            </>
          )}
        </PlotFrame>
      </svg>

      {isHeat && (
        <div className="heat-key">
          <span>0</span><i /><span>{maximumDistance.toFixed(1)} {unit}</span>
        </div>
      )}
      {isSurface && (
        <Legend
          items={[
            { color: "#138a5b", label: "Within tolerance" },
            { color: "#f29a38", label: "Outside tolerance" },
            { color: "#17233a", label: "Maximum HD pair", dashed: true },
          ]}
        />
      )}
      {isAcceptance && (
        <Legend
          items={[
            { color: "#2268c7", label: "Reference contour" },
            { color: "#bfe8d3", label: "Reference tolerance band" },
            { color: "#138a5b", label: "Test within tolerance" },
            { color: "#f29a38", label: "Test outside tolerance" },
          ]}
        />
      )}
      {isApl && (
        <Legend
          items={[
            { color: "#138a5b", label: "Ground-truth path represented in test" },
            { color: "#f29a38", label: "Path to add to test (APL)" },
          ]}
        />
      )}
      {isOverlap && (
        <Legend items={[{ color: "#2268c7", label: "Reference" }, { color: "#ea5b61", label: "Test" }]} />
      )}
    </article>
  );
}

export function DistanceHistogram({ metrics, unit }: { metrics: ContourMetrics; unit: string }) {
  const values = [...metrics.aToB, ...metrics.bToA].filter(Number.isFinite);
  const data = histogram(values, 24);
  const maximumCount = Math.max(1, ...data.counts);
  const maximumDistance = data.edges[data.edges.length - 1];
  const x = (value: number) => LEFT + (value / maximumDistance) * PLOT;
  const y = (value: number) => TOP + PLOT - (value / maximumCount) * PLOT;
  const markers = [
    { value: metrics.meanSurfaceDistance, color: "#d43d4b", label: `Mean ${metrics.meanSurfaceDistance.toFixed(2)}` },
    { value: metrics.hausdorffPercentile, color: "#ee942f", label: `HD${Math.round(metrics.percentile)} ${metrics.hausdorffPercentile.toFixed(2)}` },
    { value: metrics.maximumHausdorff, color: "#7654b5", label: `Max ${metrics.maximumHausdorff.toFixed(2)}` },
    { value: metrics.threshold, color: "#138a5b", label: `Threshold ${metrics.threshold.toFixed(2)}` },
  ];

  return (
    <article className="plot-card">
      <div className="plot-card-heading"><h3>Surface Distance Distribution</h3></div>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="Histogram of bidirectional surface distances" className="metric-plot">
        <rect x={LEFT} y={TOP} width={PLOT} height={PLOT} rx="8" className="plot-background" />
        {data.counts.map((count, index) => {
          const barWidth = PLOT / data.counts.length;
          return (
            <rect
              key={`bar-${index}`}
              x={LEFT + index * barWidth + 1}
              y={y(count)}
              width={Math.max(1, barWidth - 2)}
              height={TOP + PLOT - y(count)}
              fill="#77b9df"
              stroke="#3d7597"
              strokeWidth="0.5"
            />
          );
        })}
        {markers.map((marker) => (
          <line
            key={marker.label}
            x1={x(clampChart(marker.value, maximumDistance))}
            x2={x(clampChart(marker.value, maximumDistance))}
            y1={TOP}
            y2={TOP + PLOT}
            stroke={marker.color}
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text key={fraction} x={LEFT + fraction * PLOT} y={TOP + PLOT + 20} textAnchor="middle" className="plot-tick">
            {(maximumDistance * fraction).toFixed(1)}
          </text>
        ))}
        <text x={LEFT + PLOT / 2} y={VIEW - 8} textAnchor="middle" className="plot-label">Distance ({unit})</text>
        <text x="13" y={TOP + PLOT / 2} textAnchor="middle" className="plot-label" transform={`rotate(-90 13 ${TOP + PLOT / 2})`}>Frequency</text>
      </svg>
      <Legend items={markers.map((marker) => ({ color: marker.color, label: marker.label, dashed: true }))} />
    </article>
  );
}

function clampChart(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, value));
}
