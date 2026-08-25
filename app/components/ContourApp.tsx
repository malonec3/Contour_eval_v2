"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ContourPlot, DistanceHistogram } from "./Plots";
import {
  type CircleParameters,
  type ContourMetrics,
  type Point,
  computeCircleMetrics,
  computePolygonMetrics,
  metricsText,
  pointInPolygon,
  transformPolygon,
  WORLD_MAX,
  WORLD_MIN,
} from "../lib/metrics";

type AppPage = "explorer" | "draw";
type ResultTab = "overview" | "distance";
type DrawingMode = "draw" | "transform";
type BackgroundChoice = "None" | "Grid" | "CT: Pelvis" | "CT: Thorax";
type PolygonSnapshot = { points: Point[]; closed: boolean };

const INITIAL_CIRCLES: CircleParameters = {
  circle1X: 0,
  circle1Y: 0,
  radius1: 3,
  noise1: 0,
  circle2X: 2,
  circle2Y: 1,
  radius2: 3.2,
  noise2: 0,
  threshold: 1,
  percentile: 95,
  samplePoints: 200,
  seed1: 12345,
  seed2: 67890,
};

const EMPTY_POLYGON: PolygonSnapshot = { points: [], closed: false };

function publicAsset(filename: string): string {
  const environment = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;
  const base = environment?.BASE_URL ?? "/";
  return `${base.endsWith("/") ? base : `${base}/`}${filename}`;
}

function downloadText(contents: string, filename: string) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function svgToImage(svg: SVGElement): Promise<HTMLImageElement> {
  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not render a plot for export."));
    image.src = url;
  });
  URL.revokeObjectURL(url);
  return image;
}

async function downloadPlotDashboard(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  const svgs = element ? Array.from(element.querySelectorAll<SVGElement>("svg.metric-plot")) : [];
  if (svgs.length === 0) throw new Error("No plots are available to export.");
  const columns = Math.min(3, svgs.length);
  const rows = Math.ceil(svgs.length / columns);
  const cell = 600;
  const header = 92;
  const canvas = document.createElement("canvas");
  canvas.width = columns * cell;
  canvas.height = header + rows * cell;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is not available in this browser.");
  context.fillStyle = "#f6f8fb";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#12213b";
  context.font = "700 32px Arial";
  context.fillText("RadOnc Contour Metrics", 36, 52);
  context.font = "18px Arial";
  context.fillStyle = "#53627a";
  context.fillText("Educational contour comparison analysis", 36, 78);
  const images = await Promise.all(svgs.map((svg) => svgToImage(svg)));
  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    context.fillStyle = "#ffffff";
    context.fillRect(column * cell + 12, header + row * cell + 12, cell - 24, cell - 24);
    context.drawImage(image, column * cell + 24, header + row * cell + 24, cell - 48, cell - 48);
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
  if (!blob) throw new Error("PNG creation failed.");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function RangeControl({
  label,
  value,
  minimum,
  maximum,
  step,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-control">
      <span><b>{label}</b><output>{value.toFixed(step < 1 ? 1 : 0)}</output></span>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function MetricPill({ label, value, tone = "blue" }: { label: string; value: string; tone?: "blue" | "green" | "orange" }) {
  return (
    <div className={`metric-pill ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricsOverview({ metrics, unit }: { metrics: ContourMetrics; unit: string }) {
  return (
    <section className="metrics-overview" aria-label="Computed metrics">
      <MetricPill label="DICE" value={metrics.dice.toFixed(3)} tone="blue" />
      <MetricPill label="Surface DICE" value={metrics.surfaceDice.toFixed(3)} tone="green" />
      <MetricPill label="Mean distance" value={`${metrics.meanSurfaceDistance.toFixed(2)} ${unit}`} tone="green" />
      <MetricPill label={`HD${Math.round(metrics.percentile)}`} value={`${metrics.hausdorffPercentile.toFixed(2)} ${unit}`} tone="orange" />
      <MetricPill label="Maximum HD" value={`${metrics.maximumHausdorff.toFixed(2)} ${unit}`} tone="orange" />
      <MetricPill label="APL (path to add)" value={`${metrics.addedPathLength.toFixed(2)} ${unit}`} tone="blue" />
    </section>
  );
}

function BoundsWarning({ metrics }: { metrics: ContourMetrics }) {
  if (!metrics.outOfBoundsA && !metrics.outOfBoundsB) return null;
  const affected = metrics.outOfBoundsA && metrics.outOfBoundsB
    ? "Both contours extend"
    : metrics.outOfBoundsA
      ? "The reference contour extends"
      : "The test contour extends";
  return (
    <p className="bounds-warning" role="status">
      {affected} beyond the displayed −10 to +10 field. Metrics use the complete contour geometry; plots crop the portion outside the field.
    </p>
  );
}

function PlotCollection({ metrics, tab, unit }: { metrics: ContourMetrics; tab: ResultTab; unit: string }) {
  return (
    <div className="plot-grid">
      {tab === "overview" ? (
        <>
          <ContourPlot metrics={metrics} kind="surface" title="Surface Distance Analysis" unit={unit} />
          <ContourPlot metrics={metrics} kind="acceptance" title="Surface Dice: Test-to-Reference Map" unit={unit} />
          <ContourPlot metrics={metrics} kind="overlap" title="2D Area Overlap" unit={unit} />
        </>
      ) : (
        <>
          <DistanceHistogram metrics={metrics} unit={unit} />
          <ContourPlot metrics={metrics} kind="heat" title="Distance Field Analysis" unit={unit} />
          <ContourPlot metrics={metrics} kind="apl" title="Added Path Length: Path to Add to Test" unit={unit} />
        </>
      )}
    </div>
  );
}

function ResultTabs({ tab, setTab }: { tab: ResultTab; setTab: (tab: ResultTab) => void }) {
  return (
    <div className="segmented compact" role="tablist" aria-label="Analysis visualisations">
      <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")} role="tab" aria-selected={tab === "overview"}>Overview</button>
      <button className={tab === "distance" ? "active" : ""} onClick={() => setTab("distance")} role="tab" aria-selected={tab === "distance"}>Distance / Heat</button>
    </div>
  );
}

function SyntheticExplorer() {
  const [draft, setDraft] = useState<CircleParameters>(INITIAL_CIRCLES);
  const [applied, setApplied] = useState<CircleParameters>(INITIAL_CIRCLES);
  const [tab, setTab] = useState<ResultTab>("overview");
  const [exportError, setExportError] = useState("");
  const metrics = useMemo(() => computeCircleMetrics(applied), [applied]);
  const update = (field: keyof CircleParameters, value: number) => setDraft((current) => ({ ...current, [field]: value }));

  const reset = () => {
    setDraft(INITIAL_CIRCLES);
    setApplied(INITIAL_CIRCLES);
  };

  const reseed = () => {
    const next = {
      ...draft,
      seed1: Math.floor(Math.random() * 2 ** 31),
      seed2: Math.floor(Math.random() * 2 ** 31),
    };
    setDraft(next);
    setApplied(next);
  };

  return (
    <div className="workspace-layout">
      <aside className="control-panel">
        <div className="panel-kicker">Synthetic explorer</div>
        <h2>Contour parameters</h2>
        <p className="panel-intro">Change the reference and test contours, then apply to compare how each metric responds.</p>

        <details open>
          <summary><i className="dot blue" />Reference contour</summary>
          <RangeControl label="X position" value={draft.circle1X} minimum={-10} maximum={10} step={0.1} onChange={(value) => update("circle1X", value)} />
          <RangeControl label="Y position" value={draft.circle1Y} minimum={-10} maximum={10} step={0.1} onChange={(value) => update("circle1Y", value)} />
          <RangeControl label="Radius" value={draft.radius1} minimum={0} maximum={8} step={0.1} onChange={(value) => update("radius1", value)} />
          <RangeControl label="Surface noise" value={draft.noise1} minimum={0} maximum={1} step={0.05} onChange={(value) => update("noise1", value)} />
        </details>

        <details open>
          <summary><i className="dot red" />Test contour</summary>
          <RangeControl label="X position" value={draft.circle2X} minimum={-10} maximum={10} step={0.1} onChange={(value) => update("circle2X", value)} />
          <RangeControl label="Y position" value={draft.circle2Y} minimum={-10} maximum={10} step={0.1} onChange={(value) => update("circle2Y", value)} />
          <RangeControl label="Radius" value={draft.radius2} minimum={0} maximum={8} step={0.1} onChange={(value) => update("radius2", value)} />
          <RangeControl label="Surface noise" value={draft.noise2} minimum={0} maximum={1} step={0.05} onChange={(value) => update("noise2", value)} />
        </details>

        <div className="analysis-controls">
          <h3>Analysis</h3>
          <RangeControl label="Distance threshold (mm)" value={draft.threshold} minimum={0.1} maximum={5} step={0.1} onChange={(value) => update("threshold", value)} />
          <RangeControl label="Hausdorff percentile" value={draft.percentile} minimum={50} maximum={99.9} step={0.1} onChange={(value) => update("percentile", value)} />
          <RangeControl label="Surface samples" value={draft.samplePoints} minimum={20} maximum={500} step={10} onChange={(value) => update("samplePoints", value)} />
        </div>

        <div className="primary-actions">
          <button className="button primary" onClick={() => setApplied(draft)}>Apply changes</button>
          <button className="button secondary" onClick={reseed}>Reseed noise</button>
        </div>
        <button className="button quiet full" onClick={reset}>Reset to defaults</button>

        <details className="definitions">
          <summary>Metric definitions</summary>
          <dl>
            <dt>DICE / Jaccard</dt><dd>2D region overlap. Higher values indicate greater agreement.</dd>
            <dt>Surface DICE</dt><dd>Arc length of both surfaces lying within tolerance, divided by their combined perimeter.</dd>
            <dt>MSD</dt><dd>Arc-length-weighted mean of bidirectional point-to-segment surface distances.</dd>
            <dt>HD percentile</dt><dd>The larger directional percentile, reducing sensitivity to isolated outliers.</dd>
            <dt>APL</dt><dd>Ground-truth boundary path not captured within tolerance by the test contour. This is the path to add when correcting the test.</dd>
          </dl>
        </details>
      </aside>

      <main className="analysis-area">
        <section className="analysis-heading">
          <div>
            <div className="eyebrow">Interactive 2D comparison</div>
            <h1>Explore contour comparison metrics</h1>
            <p>See why overlap and surface metrics describe different aspects of agreement.</p>
          </div>
          <div className="status-chip"><span /> Calculated locally</div>
        </section>

        <MetricsOverview metrics={metrics} unit="mm" />
        <BoundsWarning metrics={metrics} />
        <section id="synthetic-dashboard" className="results-surface dashboard-export">
          <div className="results-toolbar">
            <ResultTabs tab={tab} setTab={setTab} />
            <span className="method-label">Overlap: {metrics.overlapMethod}</span>
          </div>
          <PlotCollection metrics={metrics} tab={tab} unit="mm" />
        </section>

        <section className="metrics-text-card">
          <div>
            <div className="eyebrow">Computed metrics</div>
            <h2>Detailed results</h2>
          </div>
          <div className="export-actions">
            <button className="button secondary" onClick={() => downloadText(metricsText(metrics), "contour-metrics.txt")}>Download TXT</button>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  setExportError("");
                  await downloadPlotDashboard("synthetic-dashboard", "contour-analysis.png");
                } catch (error) {
                  setExportError(error instanceof Error ? error.message : "PNG export failed.");
                }
              }}
            >Download PNG</button>
          </div>
          <pre>{metricsText(metrics)}</pre>
          {exportError && <p className="inline-error" role="alert">{exportError}</p>}
        </section>
      </main>
    </div>
  );
}

function usePolygonHistory() {
  const [current, setCurrent] = useState<PolygonSnapshot>(EMPTY_POLYGON);
  const [past, setPast] = useState<PolygonSnapshot[]>([]);
  const [future, setFuture] = useState<PolygonSnapshot[]>([]);

  const commit = useCallback((next: PolygonSnapshot) => {
    setPast((items) => [...items, current]);
    setFuture([]);
    setCurrent(next);
  }, [current]);

  const preview = useCallback((next: PolygonSnapshot) => setCurrent(next), []);
  const commitPreview = useCallback((start: PolygonSnapshot) => {
    setPast((items) => [...items, start]);
    setFuture([]);
  }, []);
  const undo = useCallback(() => {
    setPast((items) => {
      if (items.length === 0) return items;
      const previous = items[items.length - 1];
      setCurrent((value) => {
        setFuture((futureItems) => [value, ...futureItems]);
        return previous;
      });
      return items.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((items) => {
      if (items.length === 0) return items;
      const next = items[0];
      setCurrent((value) => {
        setPast((pastItems) => [...pastItems, value]);
        return next;
      });
      return items.slice(1);
    });
  }, []);
  return { current, commit, preview, commitPreview, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

function worldFromPointer(event: React.PointerEvent<SVGSVGElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: WORLD_MIN + ((event.clientX - rect.left) / rect.width) * (WORLD_MAX - WORLD_MIN),
    y: WORLD_MAX - ((event.clientY - rect.top) / rect.height) * (WORLD_MAX - WORLD_MIN),
  };
}

function screenPoint(point: Point): Point {
  return {
    x: ((point.x - WORLD_MIN) / (WORLD_MAX - WORLD_MIN)) * 480,
    y: ((WORLD_MAX - point.y) / (WORLD_MAX - WORLD_MIN)) * 480,
  };
}

function DrawingCanvas({
  label,
  color,
  snapshot,
  mode,
  background,
  onCommit,
  onPreview,
  onCommitPreview,
}: {
  label: string;
  color: "blue" | "red";
  snapshot: PolygonSnapshot;
  mode: DrawingMode;
  background: BackgroundChoice;
  onCommit: (snapshot: PolygonSnapshot) => void;
  onPreview: (snapshot: PolygonSnapshot) => void;
  onCommitPreview: (start: PolygonSnapshot) => void;
}) {
  const drag = useRef<{ start: Point; original: PolygonSnapshot } | null>(null);
  const stroke = color === "blue" ? "#1766c2" : "#d94752";
  const fill = color === "blue" ? "rgba(34,104,199,.20)" : "rgba(234,91,97,.20)";
  const backgroundImage = background === "CT: Pelvis"
    ? publicAsset("ct_pelvis.png")
    : background === "CT: Thorax"
      ? publicAsset("ct_thorax.png")
      : null;
  const points = snapshot.points.map(screenPoint);
  const pointsAttribute = points.map((point) => `${point.x},${point.y}`).join(" ");

  const addPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== "draw" || snapshot.closed) return;
    const nextPoint = worldFromPointer(event);
    const closeDistance = snapshot.points.length >= 3 ? Math.hypot(nextPoint.x - snapshot.points[0].x, nextPoint.y - snapshot.points[0].y) : Number.POSITIVE_INFINITY;
    if (closeDistance < 0.55) {
      onCommit({ ...snapshot, closed: true });
      return;
    }
    onCommit({ points: [...snapshot.points, nextPoint], closed: false });
  };

  const startTransform = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode !== "transform" || !snapshot.closed || !pointInPolygon(worldFromPointer(event), snapshot.points)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: worldFromPointer(event), original: snapshot };
  };

  const moveTransform = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const currentPoint = worldFromPointer(event);
    const translation = { x: currentPoint.x - drag.current.start.x, y: currentPoint.y - drag.current.start.y };
    onPreview({ points: transformPolygon(drag.current.original.points, translation, 1, 0), closed: true });
  };

  const finishTransform = () => {
    if (!drag.current) return;
    onCommitPreview(drag.current.original);
    drag.current = null;
  };

  return (
    <section className="drawing-pane">
      <div className="drawing-pane-title"><i className={`dot ${color}`} /><h3>{label}</h3><span>{snapshot.closed ? "Closed" : `${snapshot.points.length} points`}</span></div>
      <div className="canvas-shell">
        {backgroundImage && (
          // A plain image is intentional: this component is shared with the static Vite/GitHub Pages build.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={backgroundImage} alt="Illustrative CT background" draggable={false} />
        )}
        <svg
          viewBox="0 0 480 480"
          className={`drawing-svg ${mode}`}
          aria-label={`${label} drawing canvas`}
          onPointerDown={(event) => { addPoint(event); startTransform(event); }}
          onPointerMove={moveTransform}
          onPointerUp={finishTransform}
          onPointerCancel={finishTransform}
          onDoubleClick={() => snapshot.points.length >= 3 && !snapshot.closed && onCommit({ ...snapshot, closed: true })}
          onContextMenu={(event) => { event.preventDefault(); if (snapshot.points.length >= 3 && !snapshot.closed) onCommit({ ...snapshot, closed: true }); }}
        >
          {background === "Grid" && Array.from({ length: 21 }, (_, index) => {
            const position = index * 24;
            const major = index % 5 === 0;
            return <g key={index}><line x1={position} y1="0" x2={position} y2="480" stroke={major ? "#cbd4df" : "#e8edf3"} /><line x1="0" y1={position} x2="480" y2={position} stroke={major ? "#cbd4df" : "#e8edf3"} /></g>;
          })}
          {snapshot.closed ? (
            <polygon points={pointsAttribute} fill={fill} stroke={stroke} strokeWidth="2.5" />
          ) : (
            <polyline points={pointsAttribute} fill="none" stroke={stroke} strokeWidth="2.5" />
          )}
          {points.map((point, index) => (
            <circle key={index} cx={point.x} cy={point.y} r={index === 0 && !snapshot.closed ? 6 : 4} fill="#fff" stroke={stroke} strokeWidth="2" />
          ))}
          {!snapshot.closed && snapshot.points.length === 0 && (
            <g className="canvas-empty"><circle cx="240" cy="210" r="28" /><path d="M228 210h24M240 198v24" /><text x="240" y="264" textAnchor="middle">Click or tap to add contour points</text></g>
          )}
        </svg>
      </div>
    </section>
  );
}

function TransformControls({ snapshot, commit }: { snapshot: PolygonSnapshot; commit: (snapshot: PolygonSnapshot) => void }) {
  const apply = (translation: Point, scale: number, rotation: number) => {
    if (!snapshot.closed) return;
    commit({ points: transformPolygon(snapshot.points, translation, scale, rotation), closed: true });
  };
  return (
    <div className="transform-controls" aria-label="Contour transform controls">
      <button onClick={() => apply({ x: -0.25, y: 0 }, 1, 0)} aria-label="Move left">←</button>
      <button onClick={() => apply({ x: 0.25, y: 0 }, 1, 0)} aria-label="Move right">→</button>
      <button onClick={() => apply({ x: 0, y: 0.25 }, 1, 0)} aria-label="Move up">↑</button>
      <button onClick={() => apply({ x: 0, y: -0.25 }, 1, 0)} aria-label="Move down">↓</button>
      <button onClick={() => apply({ x: 0, y: 0 }, 0.95, 0)}>− size</button>
      <button onClick={() => apply({ x: 0, y: 0 }, 1.05, 0)}>+ size</button>
      <button onClick={() => apply({ x: 0, y: 0 }, 1, -5)}>↶ 5°</button>
      <button onClick={() => apply({ x: 0, y: 0 }, 1, 5)}>↷ 5°</button>
    </div>
  );
}

function DrawingWorkspace() {
  const reference = usePolygonHistory();
  const test = usePolygonHistory();
  const [mode, setMode] = useState<DrawingMode>("draw");
  const [background, setBackground] = useState<BackgroundChoice>("Grid");
  const [threshold, setThreshold] = useState(1);
  const [percentileValue, setPercentileValue] = useState(95);
  const [results, setResults] = useState<ContourMetrics | null>(null);
  const [tab, setTab] = useState<ResultTab>("overview");
  const [message, setMessage] = useState("");
  const ctMode = background.startsWith("CT:");
  const unit = ctMode ? "cm" : "mm";

  const changeBackground = (choice: BackgroundChoice) => {
    setBackground(choice);
    setThreshold(choice.startsWith("CT:") ? 0.5 : 1);
  };

  const calculate = () => {
    if (!reference.current.closed || !test.current.closed) {
      setMessage("Close both contours before calculating the metrics.");
      return;
    }
    try {
      setResults(computePolygonMetrics(reference.current.points, test.current.points, threshold, percentileValue));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The contours could not be analysed.");
    }
  };

  const canvasToolbar = (history: ReturnType<typeof usePolygonHistory>, name: string) => (
    <div className="canvas-toolbar" aria-label={`${name} contour controls`}>
      <button onClick={history.undo} disabled={!history.canUndo}>Undo</button>
      <button onClick={history.redo} disabled={!history.canRedo}>Redo</button>
      <button onClick={() => history.commit({ ...history.current, closed: true })} disabled={history.current.closed || history.current.points.length < 3}>Close contour</button>
      <button className="danger" onClick={() => history.commit(EMPTY_POLYGON)} disabled={history.current.points.length === 0}>Delete</button>
    </div>
  );

  return (
    <main className="draw-workspace">
      <section className="draw-header">
        <div>
          <div className="eyebrow">Freehand polygon comparison</div>
          <h1>Draw two contours and compare</h1>
          <p>Draw a reference structure and a test structure, then explore how region and surface metrics respond.</p>
        </div>
        <div className="status-chip"><span /> Calculated locally</div>
      </section>

      <section className="instruction-strip">
        <div><b>1</b><span><strong>Draw</strong> Add points and close each loop.</span></div>
        <div><b>2</b><span><strong>Transform</strong> Drag, rotate, scale or nudge.</span></div>
        <div><b>3</b><span><strong>Compare</strong> Select a threshold and press Calculate.</span></div>
      </section>

      <section className="drawing-controls-card">
        <div>
          <span className="control-label">Interaction</span>
          <div className="segmented compact">
            <button className={mode === "draw" ? "active" : ""} onClick={() => setMode("draw")}>Draw</button>
            <button className={mode === "transform" ? "active" : ""} onClick={() => setMode("transform")}>Transform</button>
          </div>
        </div>
        <label>
          <span className="control-label">Canvas background</span>
          <select value={background} onChange={(event) => changeBackground(event.target.value as BackgroundChoice)}>
            <option>None</option><option>Grid</option><option>CT: Pelvis</option><option>CT: Thorax</option>
          </select>
        </label>
        <div className="threshold-control">
          <RangeControl
            label={`Distance threshold (${unit}${ctMode ? "*" : ""})`}
            value={threshold}
            minimum={0}
            maximum={ctMode ? 1 : 5}
            step={0.1}
            onChange={setThreshold}
          />
        </div>
        <div className="threshold-control">
          <RangeControl label="HD percentile" value={percentileValue} minimum={50} maximum={99.9} step={0.1} onChange={setPercentileValue} />
        </div>
      </section>
      {ctMode && <p className="ct-warning">* CT backgrounds are illustrative only. The displayed centimetre scale is relative and is not calibrated to the source image pixel spacing.</p>}

      <div className="drawing-grid">
        <div>
          <DrawingCanvas label="Reference contour A" color="blue" snapshot={reference.current} mode={mode} background={background} onCommit={reference.commit} onPreview={reference.preview} onCommitPreview={reference.commitPreview} />
          {canvasToolbar(reference, "Reference")}
          {mode === "transform" && <TransformControls snapshot={reference.current} commit={reference.commit} />}
        </div>
        <div>
          <DrawingCanvas label="Test contour B" color="red" snapshot={test.current} mode={mode} background={background} onCommit={test.commit} onPreview={test.preview} onCommitPreview={test.commitPreview} />
          {canvasToolbar(test, "Test")}
          {mode === "transform" && <TransformControls snapshot={test.current} commit={test.commit} />}
        </div>
      </div>

      <section className="draw-actions">
        <button className="button primary large" onClick={calculate}>Calculate metrics</button>
        <button className="button secondary" onClick={() => setResults(null)} disabled={!results}>Clear results</button>
        {message && <p className="inline-error" role="alert">{message}</p>}
      </section>

      {!results ? (
        <section className="empty-results"><div>∿</div><h2>Your comparison will appear here</h2><p>Close both contours and calculate to see overlap, surface distances and added path length.</p></section>
      ) : (
        <section className="draw-results">
          <div className="results-title-row"><div><div className="eyebrow">Computed comparison</div><h2>Contour analysis</h2></div><ResultTabs tab={tab} setTab={setTab} /></div>
          <MetricsOverview metrics={results} unit={unit} />
          <BoundsWarning metrics={results} />
          <div id="drawing-dashboard" className="results-surface dashboard-export"><PlotCollection metrics={results} tab={tab} unit={unit} /></div>
          <div className="three-metric-groups">
            <article><h3>2D overlap</h3><p><span>DICE coefficient</span><b>{results.dice.toFixed(4)}</b></p><p><span>Jaccard index</span><b>{results.jaccard.toFixed(4)}</b></p><p><span>Area ratio</span><b>{results.volumeRatio.toFixed(4)}</b></p></article>
            <article><h3>Surface metrics</h3><p><span>Surface DICE</span><b>{results.surfaceDice.toFixed(4)}</b></p><p><span>Mean distance</span><b>{results.meanSurfaceDistance.toFixed(3)} {unit}</b></p><p><span>HD{Math.round(results.percentile)}</span><b>{results.hausdorffPercentile.toFixed(3)} {unit}</b></p></article>
            <article><h3>Geometry &amp; path edits</h3><p><span>Reference area</span><b>{results.areaA.toFixed(2)} {unit}²</b></p><p><span>Test area</span><b>{results.areaB.toFixed(2)} {unit}²</b></p><p><span>APL: path to add</span><b>{results.addedPathLength.toFixed(2)} {unit}</b></p><p><span>Test excess path</span><b>{results.testExcessPathLength.toFixed(2)} {unit}</b></p><p><span>Bidirectional total</span><b>{results.bidirectionalPathLength.toFixed(2)} {unit}</b></p></article>
          </div>
          <div className="export-actions end">
            <button className="button secondary" onClick={() => downloadText(metricsText(results, unit), "drawn-contour-metrics.txt")}>Download TXT</button>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  setMessage("");
                  await downloadPlotDashboard("drawing-dashboard", "drawn-contour-analysis.png");
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "PNG export failed.");
                }
              }}
            >Download PNG</button>
          </div>
        </section>
      )}
    </main>
  );
}

export default function ContourApp() {
  const [page, setPage] = useState<AppPage>("explorer");
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="RadOnc Contour Metrics home">
          <span className="brand-mark"><i /><i /></span>
          <span><b>RadOnc</b><small>Contour Metrics Lab</small></span>
        </a>
        <nav aria-label="Application sections">
          <button className={page === "explorer" ? "active" : ""} onClick={() => setPage("explorer")}><span>◉</span> Metric explorer</button>
          <button className={page === "draw" ? "active" : ""} onClick={() => setPage("draw")}><span>✎</span> Draw contours</button>
        </nav>
        <div className="education-badge">Educational tool</div>
      </header>
      {page === "explorer" ? <SyntheticExplorer /> : <DrawingWorkspace />}
      <footer>
        <p><strong>RadOnc Contour Metrics Lab</strong> · Ciaran Malone · Version 2.2.0</p>
        <p>Educational use only. Metric acceptability is task- and context-dependent. <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a></p>
      </footer>
    </div>
  );
}
