"use client";

import { useId, useMemo, useState } from "react";
import { axisTicks, computeGeometry, resultPoint, type Point2D } from "@/lib/geometry";
import { formatNumber } from "@/lib/format";
import type { OptimizationModel, OptimizationResult } from "@/lib/model";

interface GeometricViewProps {
  model: OptimizationModel;
  /** Only the result for this exact model snapshot. Stale results stay outside. */
  result: OptimizationResult | null;
  isStale: boolean;
  highlightedConstraintId: string | null;
  onHighlight: (constraintId: string | null) => void;
}

const LEFT = 52;
const TOP = 24;
const WIDTH = 400;
const HEIGHT = 320;

export function GeometricView({ model, result, isStale, highlightedConstraintId, onHighlight }: GeometricViewProps) {
  const clipId = useId();
  const hatchId = useId();
  const [highlightedBoundKey, setHighlightedBoundKey] = useState<string | null>(null);
  // Defensive stale guard: an old result must affect neither marker nor framing.
  const currentResult = isStale ? null : result;
  const optimal = resultPoint(model, currentResult);
  const geometry = useMemo(() => computeGeometry(model, resultPoint(model, currentResult)), [model, currentResult]);
  const activeIds = new Set(currentResult?.constraints.filter((row) => row.active).map((row) => row.constraintId));

  if (geometry.status === "unsupported" || geometry.status === "numerical-error") {
    return <div className="geometry-panel">
      <div className="geometry-empty" role="status">
        <p className="geometry-empty-symbol" aria-hidden="true">{geometry.status === "unsupported" ? "ℝ²" : "≈"}</p>
        <p>{geometry.status === "unsupported"
          ? `La vista geométrica requiere exactamente dos variables. El modelo actual tiene ${model.variables.length}.`
          : "La escala numérica supera la precisión de esta vista. Reescala los coeficientes para visualizarla."}</p>
        <p className="technical-note">Puedes seguir editando y resolviendo el modelo con HiGHS.</p>
      </div>
    </div>;
  }

  const { viewport, boundaries, region } = geometry;
  const x = (value: number) => LEFT + (value - viewport.xMin) / (viewport.xMax - viewport.xMin) * WIDTH;
  const y = (value: number) => TOP + HEIGHT - (value - viewport.yMin) / (viewport.yMax - viewport.yMin) * HEIGHT;
  const points = (values: Point2D[]) => values.map((p) => `${x(p.x)},${y(p.y)}`).join(" ");
  const xTicks = axisTicks(viewport.xMin, viewport.xMax);
  const yTicks = axisTicks(viewport.yMin, viewport.yMax);
  const xAxisY = y(Math.max(viewport.yMin, Math.min(viewport.yMax, 0)));
  const yAxisX = x(Math.max(viewport.xMin, Math.min(viewport.xMax, 0)));
  const isHighlighted = (line: typeof boundaries[number]) => highlightedConstraintId !== null
    ? line.constraintId === highlightedConstraintId : line.key === highlightedBoundKey;
  const highlighted = boundaries.find(isHighlighted);
  function highlight(line: typeof boundaries[number] | null) {
    setHighlightedBoundKey(line?.variableId ? line.key : null);
    onHighlight(line?.constraintId ?? null);
  }
  const infeasible = geometry.status === "infeasible";

  return (
    <div className="geometry-panel">
      <p className={`geometry-state${infeasible ? " geometry-state-error" : ""}`} role="status">
        {infeasible ? "Sin región factible" : geometry.status === "unbounded" ? "Región factible no acotada" : "Región factible acotada"}
      </p>
      <svg className="geometry-plot" viewBox="0 0 480 400" role="group" aria-label="Geometría del modelo en dos variables">
        <title>Región factible y fronteras de las restricciones</title>
        <desc>La zona rayada satisface todas las restricciones y cotas. Explora una frontera para ver su lado permitido. El óptimo procede de HiGHS.</desc>
        <defs>
          <clipPath id={clipId}><rect x={LEFT} y={TOP} width={WIDTH} height={HEIGHT} /></clipPath>
          <pattern id={hatchId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="7" className="geometry-hatch" />
          </pattern>
        </defs>
        <g className="geometry-grid" aria-hidden="true">
          {xTicks.map((tick) => <line key={`x${tick}`} x1={x(tick)} x2={x(tick)} y1={TOP} y2={TOP + HEIGHT} />)}
          {yTicks.map((tick) => <line key={`y${tick}`} x1={LEFT} x2={LEFT + WIDTH} y1={y(tick)} y2={y(tick)} />)}
        </g>
        <g clipPath={`url(#${clipId})`}>
          {highlighted?.allowed ? <polygon points={points(highlighted.allowed)} className="geometry-halfplane" data-testid="allowed-halfplane" /> : null}
          {region.length >= 3 ? <g data-testid="feasible-region">
            <polygon points={points(region)} className="geometry-region" />
            <polygon points={points(region)} fill={`url(#${hatchId})`} />
          </g> : region.length === 2 ? <polyline data-testid="feasible-region" points={points(region)} className="geometry-region-segment" />
            : region.length === 1 ? <circle data-testid="feasible-region" cx={x(region[0].x)} cy={y(region[0].y)} r="4" className="geometry-region-point" /> : null}
          {boundaries.map((line) => {
            const selected = isHighlighted(line);
            const active = line.constraintId !== null && activeIds.has(line.constraintId);
            return line.segment.length === 2 ? <g key={line.key} data-constraint-id={line.constraintId ?? undefined}
              data-testid={line.constraintId ? `boundary-${line.constraintId}` : undefined}
              data-active={active} data-highlighted={selected}
              className={`geometry-boundary${line.variableId ? " geometry-bound" : ""}${selected ? " is-highlighted" : ""}${active ? " is-active" : ""}`}
              onMouseEnter={() => highlight(line)} onMouseLeave={() => highlight(null)}>
              <title>{`${line.name}${active ? " · activa en la solución vigente" : ""}`}</title>
              <polyline points={points(line.segment)} className="geometry-line" />
              <polyline points={points(line.segment)} className="geometry-line-target" />
            </g> : null;
          })}
          {optimal && !infeasible ? <g data-testid="optimal-point" data-x={optimal.x} data-y={optimal.y}
            aria-label={`Óptimo de HiGHS: ${model.variables[0].name} = ${formatNumber(optimal.x)}, ${model.variables[1].name} = ${formatNumber(optimal.y)}`}>
            <circle cx={x(optimal.x)} cy={y(optimal.y)} r="9" className="geometry-optimal-halo" />
            <circle cx={x(optimal.x)} cy={y(optimal.y)} r="4.5" className="geometry-optimal" />
          </g> : null}
        </g>
        <g className="geometry-axes" aria-hidden="true">
          <line x1={LEFT} x2={LEFT + WIDTH} y1={xAxisY} y2={xAxisY} />
          <line x1={yAxisX} x2={yAxisX} y1={TOP} y2={TOP + HEIGHT} />
          {xTicks.map((tick) => <text key={tick} x={x(tick)} y={TOP + HEIGHT + 20} textAnchor="middle">{formatTick(tick)}</text>)}
          {yTicks.map((tick) => <text key={tick} x={LEFT - 9} y={y(tick) + 4} textAnchor="end">{formatTick(tick)}</text>)}
          <text x={LEFT + WIDTH} y="390" textAnchor="end" className="geometry-axis-name">{axisName(model.variables[0].name)}</text>
          <text x={LEFT} y="14" className="geometry-axis-name">{axisName(model.variables[1].name)}</text>
        </g>
      </svg>
      <div className="geometry-key">
        <span><i className="key-region" aria-hidden="true" />Factible</span>
        <span><i className="key-line" aria-hidden="true" />Frontera</span>
        {currentResult?.status === "optimal" ? <span><i className="key-active" aria-hidden="true" />Activa</span> : null}
        {optimal ? <span><i className="key-point" aria-hidden="true" />Óptimo</span> : null}
      </div>
      <p className="geometry-explanation">
        {infeasible ? "Ningún punto satisface simultáneamente las restricciones y las cotas."
          : geometry.status === "unbounded" ? "La región continúa fuera de esta ventana. Sus bordes de recorte no son restricciones."
          : region.length < 3 ? "La región factible tiene dimensión menor que dos: es un segmento o un punto."
          : "La intersección rayada incluye las cotas de las variables."}
      </p>
      {isStale ? <p className="geometry-stale" role="status">Óptimo anterior oculto. Resuelve el modelo actualizado.</p>
        : optimal ? <p className="geometry-solution formula">Óptimo HiGHS · ({formatNumber(optimal.x)}; {formatNumber(optimal.y)})</p> : null}
      <div className="geometry-boundary-list" aria-label="Fronteras del modelo">
        {boundaries.map((line) => <button key={line.key} type="button"
          className={`geometry-boundary-label${line.constraintId && activeIds.has(line.constraintId) ? " is-active" : ""}`}
          aria-label={`Explorar frontera: ${line.name}`}
          aria-pressed={isHighlighted(line)}
          onMouseEnter={() => highlight(line)} onMouseLeave={() => highlight(null)}
          onFocus={() => highlight(line)} onBlur={() => highlight(null)}
          onClick={() => highlight(line)}>
          {line.name}{line.operator === "=" ? " · igualdad" : ""}{line.segment.length === 0 ? " · fuera de ventana o sin frontera" : ""}
        </button>)}
      </div>
      <p className="technical-note geometry-hint">Pasa sobre una restricción o enfoca su nombre para explorar su frontera y su lado permitido.</p>
    </div>
  );
}

function formatTick(value: number): string {
  return Math.abs(value) >= 10000 || (value !== 0 && Math.abs(value) < 0.01)
    ? value.toExponential(0) : formatNumber(value);
}

function axisName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}
