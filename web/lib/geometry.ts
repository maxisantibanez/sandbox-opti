import type { ConstraintOperator, OptimizationModel, OptimizationResult } from "./model";

export interface Point2D { x: number; y: number }
export interface Viewport { xMin: number; xMax: number; yMin: number; yMax: number }
interface HalfPlane { a: number; b: number; c: number }
export interface GeometryBoundary extends HalfPlane {
  key: string;
  constraintId: string | null;
  variableId: string | null;
  name: string;
  operator: ConstraintOperator;
}
export interface VisibleBoundary extends GeometryBoundary {
  segment: Point2D[];
  allowed: Point2D[] | null;
}
export interface Geometry2D {
  status: "bounded" | "unbounded" | "infeasible";
  variableIds: [string, string];
  viewport: Viewport;
  boundaries: VisibleBoundary[];
  vertices: Point2D[];
  /** Intersection clipped to the viewport, possibly a segment or a single point. */
  region: Point2D[];
}
export type Geometry = Geometry2D | { status: "unsupported" } | { status: "numerical-error" };

// Distances are measured after normalizing each normal to unit length. The
// absolute floor is in variable units; the second term bounds arithmetic noise
// at large coordinates. This is NOT HiGHS' active-constraint tolerance.
const DISTANCE_EPS = 1e-9;
const ROUNDING_EPS = 64 * Number.EPSILON;
const ANGLE_EPS = 32 * Number.EPSILON;
const finitePoint = (p: Point2D) => Number.isFinite(p.x) && Number.isFinite(p.y);
const residual = (h: HalfPlane, p: Point2D) => h.a * p.x + h.b * p.y - h.c;
const tolerance = (h: HalfPlane, p: Point2D) =>
  DISTANCE_EPS + ROUNDING_EPS * (Math.abs(h.a * p.x) + Math.abs(h.b * p.y) + Math.abs(h.c));
const inside = (h: HalfPlane, p: Point2D) => h.a === 0 && h.b === 0
  ? h.c >= 0 : residual(h, p) <= tolerance(h, p);
const reverse = (h: HalfPlane): HalfPlane => ({ a: -h.a, b: -h.b, c: -h.c });

function normalized(a: number, b: number, c: number): HalfPlane {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return { a: 0, b: 0, c };
  const length = Math.hypot(a / scale, b / scale);
  return { a: a / scale / length, b: b / scale / length, c: c / scale / length };
}

function halfPlanes(boundary: GeometryBoundary): HalfPlane[] {
  if (boundary.operator === "<=") return [boundary];
  if (boundary.operator === ">=") return [reverse(boundary)];
  return [boundary, reverse(boundary)];
}

function modelBoundaries(model: OptimizationModel): GeometryBoundary[] {
  const [x, y] = model.variables;
  const boundaries: GeometryBoundary[] = model.constraints.map((constraint) => ({
    ...normalized(
      constraint.terms.find((term) => term.variableId === x.id)?.coefficient ?? 0,
      constraint.terms.find((term) => term.variableId === y.id)?.coefficient ?? 0,
      constraint.rhs,
    ),
    key: `constraint:${constraint.id}`,
    constraintId: constraint.id,
    variableId: null,
    name: constraint.name,
    operator: constraint.operator,
  }));
  model.variables.forEach((variable, index) => {
    for (const side of ["lower", "upper"] as const) {
      const value = side === "lower" ? variable.lowerBound : variable.upperBound;
      if (value === null) continue;
      const operator = side === "lower" ? ">=" : "<=";
      boundaries.push({
        a: index === 0 ? 1 : 0, b: index === 1 ? 1 : 0, c: value,
        key: `bound:${variable.id}:${side}`, constraintId: null, variableId: variable.id,
        name: `${variable.name} ${operator === ">=" ? "≥" : "≤"} ${value}`,
        operator,
      });
    }
  });
  return boundaries;
}

/** Intersection of infinite boundaries, never slope/intercept division. */
export function intersectBoundaries(first: HalfPlane, second: HalfPlane): Point2D | null {
  const f = normalized(first.a, first.b, first.c);
  const s = normalized(second.a, second.b, second.c);
  const determinant = f.a * s.b - s.a * f.b;
  if (Math.abs(determinant) <= ANGLE_EPS) return null;
  const point = { x: (f.c * s.b - s.c * f.b) / determinant,
    y: (f.a * s.c - s.a * f.c) / determinant };
  return finitePoint(point) ? point : null;
}

/** Feasible interval on p(t) = c*n + t*(-b,a), including infinite endpoints. */
function boundaryInterval(line: HalfPlane, planes: HalfPlane[]) {
  if (line.a === 0 && line.b === 0) return null;
  const base = { x: line.a * line.c, y: line.b * line.c };
  const direction = { x: -line.b, y: line.a };
  let lower = -Infinity;
  let upper = Infinity;
  for (const plane of planes) {
    const slope = plane.a * direction.x + plane.b * direction.y;
    const remaining = -residual(plane, base);
    if (Math.abs(slope) <= ANGLE_EPS) {
      if (!inside(plane, base)) return null;
    } else if (slope > 0) {
      upper = Math.min(upper, remaining / slope);
    } else {
      lower = Math.max(lower, remaining / slope);
    }
  }
  const at = (t: number): Point2D => ({ x: base.x + direction.x * t, y: base.y + direction.y * t });
  const witness = at(Math.max(lower, Math.min(upper, 0)));
  if (!finitePoint(witness) || !planes.every((plane) => inside(plane, witness))) return null;
  return { witness, endpoints: [lower, upper].filter(Number.isFinite).map(at).filter(finitePoint) };
}

function unique(points: Point2D[]): Point2D[] {
  return points.filter((point, index) => !points.slice(0, index).some((other) => samePoint(point, other)));
}

function samePoint(point: Point2D, other: Point2D): boolean {
  return Math.hypot(point.x - other.x, point.y - other.y) <=
    DISTANCE_EPS + ROUNDING_EPS * Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(other.x), Math.abs(other.y));
}

/** Convex clipping also retains degenerate intersections (segments and points). */
function clip(polygon: Point2D[], plane: HalfPlane): Point2D[] {
  const output: Point2D[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const d0 = residual(plane, start);
    const d1 = residual(plane, end);
    const in0 = inside(plane, start);
    const in1 = inside(plane, end);
    if (in0) output.push(start);
    if (in0 !== in1) {
      const t = Math.max(0, Math.min(1, d0 / (d0 - d1)));
      output.push({ x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) });
    }
  }
  // In a convex cyclic polygon duplicates are consecutive (including the
  // closing pair). Linear cleanup keeps sequential clipping quadratic overall.
  const compact = output.filter((point, index) => index === 0 || !samePoint(point, output[index - 1]));
  if (compact.length > 1 && samePoint(compact[0], compact[compact.length - 1])) compact.pop();
  return compact;
}

function rectangle(v: Viewport): Point2D[] {
  return [{ x: v.xMin, y: v.yMin }, { x: v.xMax, y: v.yMin },
    { x: v.xMax, y: v.yMax }, { x: v.xMin, y: v.yMax }];
}

function viewportPlanes(v: Viewport): HalfPlane[] {
  return [{ a: 1, b: 0, c: v.xMax }, { a: -1, b: 0, c: -v.xMin },
    { a: 0, b: 1, c: v.yMax }, { a: 0, b: -1, c: -v.yMin }];
}

function chooseViewport(points: Point2D[], optimal: Point2D | null): Viewport {
  const useful = points.length ? points : [{ x: 0, y: 0 }];
  const all = optimal ? [...useful, optimal] : useful;
  const range = (axis: "x" | "y") => {
    const values = all.map((p) => p[axis]);
    let low = Math.min(...values);
    let high = Math.max(...values);
    // Include the origin only when it will not crush a distant local region.
    if (Math.min(Math.abs(low), Math.abs(high)) <= 2 * Math.max(high - low, 10)) {
      low = Math.min(0, low); high = Math.max(0, high);
    }
    const span = Math.max(high - low, Math.max(Math.abs(low), Math.abs(high)) * 0.05, 10);
    const middle = low + (high - low) / 2;
    return [middle - span * 0.65, middle + span * 0.65];
  };
  const [xMin, xMax] = range("x");
  const [yMin, yMax] = range("y");
  // Renderer plot ratio is 5:4. Equal units preserve slopes and angles.
  const width = Math.max(xMax - xMin, (yMax - yMin) * 1.25);
  const height = width / 1.25;
  const centerX = xMin + (xMax - xMin) / 2;
  const centerY = yMin + (yMax - yMin) / 2;
  return { xMin: centerX - width / 2, xMax: centerX + width / 2,
    yMin: centerY - height / 2, yMax: centerY + height / 2 };
}

/** Read only a current result supplied by the caller; never compute an optimum. */
export function resultPoint(model: OptimizationModel, result: OptimizationResult | null): Point2D | null {
  if (model.variables.length !== 2 || result?.status !== "optimal") return null;
  const x = result.variableValues.find((value) => value.variableId === model.variables[0].id)?.value;
  const y = result.variableValues.find((value) => value.variableId === model.variables[1].id)?.value;
  if (x === undefined || y === undefined) return null;
  const point = { x, y };
  return finitePoint(point) ? point : null;
}

/** Disposable derivation of the canonical model. No objective optimization. O(n²). */
export function computeGeometry(model: OptimizationModel, optimal: Point2D | null = null): Geometry {
  if (model.variables.length !== 2) return { status: "unsupported" };
  const boundaries = modelBoundaries(model);
  // Refuse unsafe numeric scales explicitly instead of inventing infeasibility.
  if (boundaries.some((line) => ![line.a, line.b, line.c].every(Number.isFinite) || Math.abs(line.c) > 1e140)) {
    return { status: "numerical-error" };
  }
  const planes = boundaries.flatMap(halfPlanes);
  const intervals = planes.map((plane) => boundaryInterval(plane, planes)).filter((interval) => interval !== null);
  const origin = { x: 0, y: 0 };
  const witness = planes.every((plane) => inside(plane, origin)) ? origin : intervals[0]?.witness;
  const vertices = unique(intervals.flatMap((interval) => interval.endpoints));
  // Every nontrivial 2D recession cone contains an axis direction or a direction
  // tangent to one of its boundary normals. Equalities contribute both normals.
  const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    ...planes.filter((h) => h.a !== 0 || h.b !== 0).flatMap((h) =>
      [{ x: -h.b, y: h.a }, { x: h.b, y: -h.a }])];
  const unbounded = directions.some((d) => planes.every((h) => h.a * d.x + h.b * d.y <= ANGLE_EPS));
  const status = !witness ? "infeasible" : unbounded ? "unbounded" : "bounded";
  // Feasible boundary intervals exclude irrelevant distant intersections. In
  // vertex-free sets (strips, lines, halfplanes), their witnesses provide scale.
  const anchors = vertices.length ? vertices : intervals.map((interval) => interval.witness);
  const fallback = boundaries.map((line) => ({ x: line.a * line.c, y: line.b * line.c }))
    .sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y)).slice(0, 4);
  const viewport = chooseViewport(anchors.length ? anchors : fallback, optimal);
  const box = rectangle(viewport);
  return {
    status, variableIds: [model.variables[0].id, model.variables[1].id], viewport, vertices,
    region: status === "infeasible" ? [] : planes.reduce(clip, box),
    boundaries: boundaries.map((line) => ({
      ...line,
      segment: boundaryInterval(line, viewportPlanes(viewport))?.endpoints ?? [],
      allowed: line.operator === "=" ? null : halfPlanes(line).reduce(clip, box),
    })),
  };
}

/** Sparse, stable ticks shared by both axes. */
export function axisTicks(min: number, max: number): number[] {
  const rough = (max - min) / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].find((factor) => factor * power >= rough)! * power;
  const ticks: number[] = [];
  for (let i = Math.ceil(min / step); i * step <= max && ticks.length < 12; i++) ticks.push(i * step);
  return ticks;
}
