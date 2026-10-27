import { describe, expect, it } from "vitest";
import type { Constraint, OptimizationModel } from "./model";
import { computeGeometry, intersectBoundaries, resultPoint, type Geometry2D } from "./geometry";
import { TEMPLATES } from "./templates";

const productMix = TEMPLATES[0].model;

function row(id: string, a: number, b: number, rhs: number, operator: Constraint["operator"] = "<="): Constraint {
  return { id, name: id, terms: [{ variableId: "x1", coefficient: a },
    { variableId: "x2", coefficient: b }], rhs, operator };
}
function model(constraints: Constraint[] = [], free = false): OptimizationModel {
  const copy = structuredClone(productMix);
  copy.constraints = constraints;
  if (free) copy.variables.forEach((variable) => { variable.lowerBound = null; });
  return copy;
}
function geometry(input: OptimizationModel): Geometry2D {
  const result = computeGeometry(input);
  if (result.status === "unsupported" || result.status === "numerical-error") throw new Error(result.status);
  return result;
}
function contains(points: { x: number; y: number }[], x: number, y: number) {
  return points.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
}

describe("2D model geometry", () => {
  it("intersects boundaries without a slope representation", () => {
    const point = intersectBoundaries({ a: 2, b: 1, c: 100 }, { a: 1, b: 2, c: 80 });
    expect(point?.x).toBeCloseTo(40);
    expect(point?.y).toBeCloseTo(20);
    expect(intersectBoundaries({ a: 1, b: 0, c: 10 }, { a: 2, b: 0, c: 30 })).toBeNull();
  });
  it("clips a vertical restriction and its allowed halfplane", () => {
    const result = geometry(model([row("vertical", 1, 0, 20)]));
    const line = result.boundaries[0];
    expect(line.segment).toHaveLength(2);
    line.segment.forEach((p) => expect(p.x).toBeCloseTo(20));
    line.allowed!.forEach((p) => expect(p.x).toBeLessThanOrEqual(20 + 1e-8));
  });
  it("clips horizontal restrictions", () => {
    const result = geometry(model([row("horizontal", 0, 1, 30)]));
    result.boundaries[0].segment.forEach((p) => expect(p.y).toBeCloseTo(30));
    expect(result.boundaries[0].segment).toHaveLength(2);
  });
  it("handles negative coefficients and >=", () => {
    const result = geometry(model([row("negative", -1, -1, -10, ">="), row("lower", -1, 0, -2)]));
    expect(result.status).toBe("bounded");
    expect(contains(result.vertices, 2, 8)).toBe(true);
    result.region.forEach((p) => {
      expect(p.x).toBeGreaterThanOrEqual(2 - 1e-8);
      expect(p.x + p.y).toBeLessThanOrEqual(10 + 1e-8);
    });
  });
  it("derives the Product Mix polygon and preserves model and identities", () => {
    const input = structuredClone(productMix);
    const before = structuredClone(input);
    const result = geometry(input);
    expect(result.status).toBe("bounded");
    expect(result.region).toHaveLength(4);
    for (const [x, y] of [[0, 0], [50, 0], [40, 20], [0, 40]]) {
      expect(contains(result.region, x, y)).toBe(true);
    }
    expect(result.boundaries.slice(0, 3).map((line) => line.constraintId)).toEqual(["machine", "labor", "packaging"]);
    expect(input).toEqual(before);
  });
  it("reports infeasibility before viewport clipping", () => {
    const result = geometry(model([row("upper", 1, 0, 1), row("lower", 1, 0, 2, ">=")]));
    expect(result.status).toBe("infeasible");
    expect(result.region).toEqual([]);
  });
  it("reports an unbounded quadrant and renders only its visible intersection", () => {
    const result = geometry(model());
    expect(result.status).toBe("unbounded");
    expect(result.region.length).toBeGreaterThan(0);
    expect(result.region.some((p) => p.x === result.viewport.xMax)).toBe(true);
  });
  it("uses lower and upper variable bounds even without explicit constraints", () => {
    const input = model();
    input.variables[0].lowerBound = -4;
    input.variables[0].upperBound = 8;
    input.variables[1].lowerBound = 2;
    input.variables[1].upperBound = 6;
    const result = geometry(input);
    expect(result.status).toBe("bounded");
    expect(result.region).toHaveLength(4);
    expect(contains(result.region, -4, 2)).toBe(true);
    expect(contains(result.region, 8, 6)).toBe(true);
    expect(result.boundaries.every((line) => line.variableId && !line.constraintId)).toBe(true);
  });
  it("keeps redundant lines without letting distant intercepts crush the viewport", () => {
    const input = structuredClone(productMix);
    input.constraints.push(row("distant", 1, 1, 1e12));
    const result = geometry(input);
    expect(result.boundaries.find((line) => line.constraintId === "distant")).toBeDefined();
    expect(result.viewport.xMax).toBeLessThan(100);
    expect(result.region).toHaveLength(4);
  });
  it("renders an equality as a segment, never a filled halfplane", () => {
    const result = geometry(model([row("equal", 1, 1, 10, "=")]));
    expect(result.status).toBe("bounded");
    expect(result.region).toHaveLength(2);
    expect(contains(result.region, 10, 0)).toBe(true);
    expect(contains(result.region, 0, 10)).toBe(true);
    expect(result.boundaries[0].allowed).toBeNull();
  });
  it("retains a feasible singleton", () => {
    const result = geometry(model([row("x", 1, 0, 3, "="), row("y", 0, 1, 4, "=")]));
    expect(result.status).toBe("bounded");
    expect(result.region).toHaveLength(1);
    expect(contains(result.region, 3, 4)).toBe(true);
  });
  it("handles a free plane, a strip and an infinite equality without vertices", () => {
    expect(geometry(model([], true)).status).toBe("unbounded");
    const strip = geometry(model([row("low", 1, 0, 1000, ">="), row("high", 1, 0, 1001)], true));
    expect(strip.status).toBe("unbounded");
    expect(strip.region.length).toBeGreaterThan(0);
    const line = geometry(model([row("line", 1, 1, 2, "=")], true));
    expect(line.status).toBe("unbounded");
    expect(line.region).toHaveLength(2);
  });
  it("handles all-zero coefficients as tautologies or contradictions", () => {
    expect(geometry(model([row("zero", 0, 0, -1)])).status).toBe("infeasible");
    expect(geometry(model([row("zero", 0, 0, 1)])).status).toBe("unbounded");
    expect(geometry(model([row("zero", 0, 0, 1, "=")])).status).toBe("infeasible");
    expect(geometry(model([row("tiny", 0, 0, -1e-12)])).status).toBe("infeasible");
  });
  it("is invariant under positive rescaling of equations", () => {
    const input = structuredClone(productMix);
    input.constraints.forEach((constraint, index) => {
      const scale = index === 0 ? 1e-15 : 1e15;
      constraint.rhs *= scale;
      constraint.terms.forEach((term) => { term.coefficient *= scale; });
    });
    const result = geometry(input);
    expect(result.status).toBe("bounded");
    expect(contains(result.region, 40, 20)).toBe(true);
  });
  it("retains narrow wedges instead of treating ordinary near-parallel lines as parallel", () => {
    const result = geometry(model([row("x", 1, 0, 1), row("slope", 1, 1e-8, 2)]));
    expect(result.status).toBe("bounded");
    expect(contains(result.vertices, 1, 1e8)).toBe(true);
  });
  it("includes a supplied optimal point in the viewport", () => {
    const result = computeGeometry(model(), { x: 10000, y: 20000 }) as Geometry2D;
    expect(result.viewport.xMax).toBeGreaterThan(10000);
    expect(result.viewport.yMax).toBeGreaterThan(20000);
  });
  it("does not confuse a distant feasible region with an empty viewport", () => {
    const result = geometry(model([row("x", 1, 0, 10000, ">="), row("y", 0, 1, 20000, ">=")]));
    expect(result.status).toBe("unbounded");
    expect(result.region.length).toBeGreaterThan(0);
  });
  it("returns an explicit numerical limitation rather than a false infeasibility", () => {
    expect(computeGeometry(model([row("huge", 1e-200, 0, 1e200)]))).toEqual({ status: "numerical-error" });
  });
  it("supports exactly two variables and takes point values by stable id", () => {
    const input = model();
    expect(resultPoint(input, { status: "optimal", objectiveValue: 2200, constraints: [], message: null,
      variableValues: [{ variableId: "x2", value: 20 }, { variableId: "x1", value: 40 }] })).toEqual({ x: 40, y: 20 });
    input.variables.pop();
    expect(computeGeometry(input)).toEqual({ status: "unsupported" });
    input.variables.push(...structuredClone(productMix.variables));
    expect(computeGeometry(input)).toEqual({ status: "unsupported" });
  });
});
