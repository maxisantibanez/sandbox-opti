import { describe, expect, it } from "vitest";

import type { OptimizationModel, OptimizationResult } from "./model";
import {
  addConstraint,
  addConstraintTerm,
  addVariable,
  removeConstraint,
  removeVariable,
  setConstraintCoefficient,
  setConstraintName,
  setConstraintOperator,
  setConstraintRhs,
  setObjectiveCoefficient,
  setObjectiveSense,
  setVariableName,
} from "./model-editing";
import {
  channelWidth,
  FLOOR,
  layoutProductMixScene,
  productHeight,
  rowPositions,
  vesselFill,
} from "./product-mix-layout";
import {
  buildProductMixScene,
  decompositionMatches,
  normalizeAmount,
  type ProductMixScene,
  type ResourceState,
} from "./product-mix-scene";
import { pruneScenario, type ScenarioDefinition } from "./scenario";
import { TEMPLATES } from "./templates";

const template = TEMPLATES.find(
  (candidate) => candidate.scenario.metadata.id === "product-mix",
)!;

interface Workspace {
  model: OptimizationModel;
  scenario: ScenarioDefinition | null;
}

function loadProductMix(): Workspace {
  return {
    model: structuredClone(template.model),
    scenario: template.scenario,
  };
}

/** Applies an edit the way Sandbox does: new model plus pruned scenario. */
function edit(
  workspace: Workspace,
  change: (model: OptimizationModel) => OptimizationModel,
): Workspace {
  const model = change(workspace.model);
  return { model, scenario: pruneScenario(workspace.scenario, model) };
}

const optimal: OptimizationResult = {
  status: "optimal",
  objectiveValue: 2200,
  variableValues: [
    { variableId: "x1", value: 40 },
    { variableId: "x2", value: 20 },
  ],
  constraints: [
    { constraintId: "machine", activity: 100, rhs: 100, slack: 0, active: true },
    { constraintId: "labor", activity: 80, rhs: 80, slack: 0, active: true },
    { constraintId: "packaging", activity: 60, rhs: 100, slack: 40, active: false },
  ],
  message: null,
};

function emptyResult(
  status: "infeasible" | "unbounded" | "error",
  message: string | null = null,
): OptimizationResult {
  return {
    status,
    objectiveValue: null,
    variableValues: [],
    constraints: [],
    message,
  };
}

function solvedScene(
  workspace: Workspace,
  result: OptimizationResult,
): ProductMixScene {
  return buildProductMixScene(workspace.model, workspace.scenario, {
    model: workspace.model,
    result,
  });
}

function resourceStates(scene: ProductMixScene): Map<string, ResourceState> {
  if (scene.solution.state !== "optimal") {
    throw new Error(`Expected an optimal scene, got ${scene.solution.state}.`);
  }
  return new Map(
    scene.solution.resources.map((state) => [state.constraintId, state]),
  );
}

function resource(scene: ProductMixScene, constraintId: string) {
  return scene.definition.resources.find(
    (candidate) => candidate.constraintId === constraintId,
  )!;
}

describe("the modelled system before solving", () => {
  it("exists without a result and invents no solution data", () => {
    const { model, scenario } = loadProductMix();
    const scene = buildProductMixScene(model, scenario, null);

    expect(scene.solution).toEqual({ state: "unsolved" });
    expect(scene.definition.products.map((product) => product.name)).toEqual([
      "Producto A",
      "Producto B",
    ]);
    expect(scene.definition.resources.map((node) => node.name)).toEqual([
      "Capacidad de máquina",
      "Mano de obra",
      "Empaque",
    ]);
    expect(scene.definition.unboundCount).toBe(0);
  });

  it("reads each capacity from the right-hand side of the model", () => {
    const { model, scenario } = loadProductMix();
    const scene = buildProductMixScene(model, scenario, null);

    expect(
      scene.definition.resources.map((node) => [node.constraintId, node.capacity]),
    ).toEqual([
      ["machine", 100],
      ["labor", 80],
      ["packaging", 100],
    ]);
    for (const node of scene.definition.resources) {
      expect(node.capacityIssues).toEqual([]);
    }
  });

  it("derives every consumption from the constraint coefficients", () => {
    const { model, scenario } = loadProductMix();
    const scene = buildProductMixScene(model, scenario, null);

    expect(
      scene.definition.consumptions.map(
        ({ constraintId, variableId, coefficient }) => [
          constraintId,
          variableId,
          coefficient,
        ],
      ),
    ).toEqual([
      ["machine", "x1", 2],
      ["machine", "x2", 1],
      ["labor", "x1", 1],
      ["labor", "x2", 2],
      ["packaging", "x1", 1],
      ["packaging", "x2", 1],
    ]);
  });

  it("derives the limit each resource alone imposes on each product", () => {
    const { model, scenario } = loadProductMix();
    const scene = buildProductMixScene(model, scenario, null);
    const limits = Object.fromEntries(
      scene.definition.consumptions.map((consumption) => [
        `${consumption.constraintId}:${consumption.variableId}`,
        consumption.resourceLimit,
      ]),
    );

    expect(limits).toEqual({
      "machine:x1": 50,
      "machine:x2": 100,
      "labor:x1": 80,
      "labor:x2": 40,
      "packaging:x1": 100,
      "packaging:x2": 100,
    });
  });

  it("keeps the objective coefficient neutral, with sign and sense", () => {
    let workspace = loadProductMix();
    let scene = buildProductMixScene(workspace.model, workspace.scenario, null);
    expect(scene.definition.objectiveSense).toBe("maximize");
    expect(
      scene.definition.products.map((product) => product.objectiveCoefficient),
    ).toEqual([40, 30]);

    workspace = edit(workspace, (model) => setObjectiveSense(model, "minimize"));
    workspace = edit(workspace, (model) =>
      setObjectiveCoefficient(model, "x2", -15),
    );
    scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(scene.definition.objectiveSense).toBe("minimize");
    expect(
      scene.definition.products.map((product) => product.objectiveCoefficient),
    ).toEqual([40, -15]);
  });

  it("changes a relation as soon as its coefficient is edited, without solving", () => {
    const workspace = edit(loadProductMix(), (model) =>
      setConstraintCoefficient(model, "machine", "x1", 4),
    );
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);
    const machineA = scene.definition.consumptions.find(
      (consumption) =>
        consumption.constraintId === "machine" && consumption.variableId === "x1",
    );

    expect(machineA).toMatchObject({ coefficient: 4, resourceLimit: 25 });
    expect(scene.solution.state).toBe("unsolved");
  });

  it("drops a relation whose coefficient becomes zero", () => {
    const workspace = edit(loadProductMix(), (model) =>
      setConstraintCoefficient(model, "machine", "x2", 0),
    );
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(
      scene.definition.consumptions.filter(
        (consumption) => consumption.constraintId === "machine",
      ),
    ).toHaveLength(1);
  });
});

describe("capacity reading of a resource-capacity binding", () => {
  it("is not interpretable when the operator is not ≤", () => {
    const workspace = edit(loadProductMix(), (model) =>
      setConstraintOperator(model, "packaging", ">="),
    );
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(resource(scene, "packaging").capacityIssues).toEqual(["operator"]);
    expect(
      scene.definition.consumptions
        .filter((consumption) => consumption.constraintId === "packaging")
        .every((consumption) => consumption.resourceLimit === null),
    ).toBe(true);
  });

  it("is not interpretable with a negative capacity", () => {
    const workspace = edit(loadProductMix(), (model) =>
      setConstraintRhs(model, "labor", -10),
    );
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(resource(scene, "labor").capacityIssues).toEqual(["negative-capacity"]);
  });

  it("is not interpretable when a represented product has a negative coefficient", () => {
    const workspace = edit(loadProductMix(), (model) =>
      setConstraintCoefficient(model, "machine", "x2", -1),
    );
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(resource(scene, "machine").capacityIssues).toEqual([
      "negative-consumption",
    ]);
  });

  it("is not interpretable when a product using it may take negative quantities", () => {
    const workspace = loadProductMix();
    const model: OptimizationModel = {
      ...workspace.model,
      variables: workspace.model.variables.map((variable) =>
        variable.id === "x1" ? { ...variable, lowerBound: null } : variable,
      ),
    };
    const scene = buildProductMixScene(model, workspace.scenario, null);

    expect(scene.definition.products[0].nonNegative).toBe(false);
    for (const node of scene.definition.resources) {
      expect(node.capacityIssues).toEqual(["product-domain"]);
    }
  });

  it("stays interpretable with zero capacity but reports no utilization", () => {
    const workspace = edit(loadProductMix(), (model) =>
      setConstraintRhs(model, "packaging", 0),
    );
    const result: OptimizationResult = {
      status: "optimal",
      objectiveValue: 0,
      variableValues: [
        { variableId: "x1", value: 0 },
        { variableId: "x2", value: 0 },
      ],
      constraints: [
        { constraintId: "machine", activity: 0, rhs: 100, slack: 100, active: false },
        { constraintId: "labor", activity: 0, rhs: 80, slack: 80, active: false },
        { constraintId: "packaging", activity: 0, rhs: 0, slack: 0, active: true },
      ],
      message: null,
    };
    const scene = solvedScene(workspace, result);
    const layout = layoutProductMixScene(scene);

    expect(resource(scene, "packaging").capacityIssues).toEqual([]);
    expect(
      scene.definition.consumptions
        .filter((consumption) => consumption.constraintId === "packaging")
        .map((consumption) => consumption.resourceLimit),
    ).toEqual([0, 0]);
    expect(resourceStates(scene).get("packaging")).toMatchObject({
      active: true,
      utilization: null,
    });
    for (const placed of layout.resources) {
      expect(Number.isFinite(placed.fillHeight)).toBe(true);
      for (const segment of placed.segments) {
        expect(Number.isFinite(segment.top)).toBe(true);
      }
    }
  });
});

describe("the solution state added by the current result", () => {
  it("adds quantities and the objective value", () => {
    const scene = solvedScene(loadProductMix(), optimal);

    expect(scene.solution).toMatchObject({
      state: "optimal",
      objectiveValue: 2200,
      products: [
        { variableId: "x1", quantity: 40, normalized: 1 },
        { variableId: "x2", quantity: 20, normalized: 0.5 },
      ],
    });
  });

  it("takes activity and active state from the backend and derives utilization", () => {
    const states = resourceStates(solvedScene(loadProductMix(), optimal));

    expect(states.get("machine")).toMatchObject({
      activity: 100,
      slack: 0,
      active: true,
      utilization: 1,
    });
    expect(states.get("labor")).toMatchObject({
      activity: 80,
      active: true,
      utilization: 1,
    });
    expect(states.get("packaging")).toMatchObject({
      activity: 60,
      slack: 40,
      active: false,
      utilization: 0.6,
    });
  });

  it("explains each activity as coefficient · quantity per product", () => {
    const states = resourceStates(solvedScene(loadProductMix(), optimal));

    expect(states.get("machine")!.shares).toEqual([
      { variableId: "x1", amount: 80 },
      { variableId: "x2", amount: 20 },
    ]);
    expect(states.get("labor")!.shares).toEqual([
      { variableId: "x1", amount: 40 },
      { variableId: "x2", amount: 40 },
    ]);
    expect(states.get("packaging")!.shares).toEqual([
      { variableId: "x1", amount: 40 },
      { variableId: "x2", amount: 20 },
    ]);
    for (const state of states.values()) {
      const sum = state.shares.reduce((total, share) => total + share.amount, 0);
      expect(sum).toBeCloseTo(state.activity, 9);
      expect(state.decompositionMatches).toBe(true);
    }
  });

  it("flags, without adjusting, a decomposition that disagrees with the backend", () => {
    const result: OptimizationResult = {
      ...optimal,
      constraints: optimal.constraints.map((row) =>
        row.constraintId === "machine" ? { ...row, activity: 97 } : row,
      ),
    };
    const scene = solvedScene(loadProductMix(), result);
    const machine = resourceStates(scene).get("machine")!;
    const placed = layoutProductMixScene(scene).resources[0];

    expect(machine.activity).toBe(97);
    expect(machine.shares).toEqual([
      { variableId: "x1", amount: 80 },
      { variableId: "x2", amount: 20 },
    ]);
    expect(machine.decompositionMatches).toBe(false);
    expect(placed.segments).toEqual([]);
    expect(placed.fillHeight).toBeCloseTo(0.97 * FLOOR.vesselHeight);
  });

  it("tolerates solver round-off within the documented tolerance", () => {
    expect(decompositionMatches([80, 20], 100 + 1e-6)).toBe(true);
    expect(decompositionMatches([80, 20], 100.01)).toBe(false);
    expect(decompositionMatches([1e9, -1e9], 1)).toBe(true);
    expect(decompositionMatches([Number.NaN], 0)).toBe(false);
  });

  it("separates use by variables without semantics from represented products", () => {
    let workspace = edit(loadProductMix(), addVariable);
    workspace = edit(workspace, (model) =>
      addConstraintTerm(model, "machine", "x3"),
    );
    const result: OptimizationResult = {
      status: "optimal",
      objectiveValue: 2000,
      variableValues: [
        { variableId: "x1", value: 40 },
        { variableId: "x2", value: 10 },
        { variableId: "x3", value: 10 },
      ],
      constraints: [
        { constraintId: "machine", activity: 100, rhs: 100, slack: 0, active: true },
        { constraintId: "labor", activity: 60, rhs: 80, slack: 20, active: false },
        { constraintId: "packaging", activity: 50, rhs: 100, slack: 50, active: false },
      ],
      message: null,
    };
    const scene = solvedScene(workspace, result);
    const machine = resourceStates(scene).get("machine")!;
    const placed = layoutProductMixScene(scene).resources[0];

    expect(resource(scene, "machine").unrepresentedVariableIds).toEqual(["x3"]);
    expect(machine.shares.map((share) => share.variableId)).toEqual(["x1", "x2"]);
    expect(machine.unrepresentedAmount).toBe(10);
    expect(machine.decompositionMatches).toBe(true);
    expect(placed.segments.map((segment) => segment.variableId)).toEqual([
      "x1",
      "x2",
      null,
    ]);
    expect(placed.segments[2].top).toBeCloseTo(FLOOR.vesselHeight);
  });

  it("does not treat a result for an older model as the current solution", () => {
    const solvedWorkspace = loadProductMix();
    const workspace = edit(solvedWorkspace, (model) =>
      setConstraintRhs(model, "machine", 120),
    );
    const scene = buildProductMixScene(workspace.model, workspace.scenario, {
      model: solvedWorkspace.model,
      result: optimal,
    });
    const layout = layoutProductMixScene(scene);

    expect(scene.solution).toEqual({ state: "stale" });
    // The system itself is still there and already reflects the edit.
    expect(resource(scene, "machine").capacity).toBe(120);
    expect(layout.products.every((placed) => placed.state === null)).toBe(true);
    expect(layout.products.every((placed) => placed.height === 0)).toBe(true);
    expect(
      layout.resources.every(
        (placed) =>
          placed.state === null &&
          placed.fillHeight === 0 &&
          placed.segments.length === 0,
      ),
    ).toBe(true);
  });

  it("treats a structurally equal but different model object as stale", () => {
    const { model, scenario } = loadProductMix();
    const scene = buildProductMixScene(model, scenario, {
      model: structuredClone(model),
      result: optimal,
    });

    expect(scene.solution.state).toBe("stale");
  });
});

describe("the system after structural edits", () => {
  it("stops representing a removed product", () => {
    const workspace = edit(loadProductMix(), (model) => removeVariable(model, "x2"));
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(scene.definition.products.map((product) => product.variableId)).toEqual([
      "x1",
    ]);
    expect(
      scene.definition.consumptions.some(
        (consumption) => consumption.variableId === "x2",
      ),
    ).toBe(false);
  });

  it("does not turn a new unbound variable into a product", () => {
    const workspace = edit(loadProductMix(), addVariable);
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(workspace.model.variables.map((variable) => variable.id)).toContain("x3");
    expect(scene.definition.products.map((product) => product.variableId)).toEqual([
      "x1",
      "x2",
    ]);
    expect(scene.definition.unboundCount).toBe(1);
  });

  it("does not create a consumption for an unbound variable in a resource", () => {
    let workspace = edit(loadProductMix(), addVariable);
    workspace = edit(workspace, (model) =>
      addConstraintTerm(model, "labor", "x3"),
    );
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(
      scene.definition.consumptions.some(
        (consumption) => consumption.variableId === "x3",
      ),
    ).toBe(false);
    expect(resource(scene, "labor").unrepresentedVariableIds).toEqual(["x3"]);
    expect(resource(scene, "labor").capacityIssues).toEqual([]);
  });

  it("stops representing a removed constraint", () => {
    const workspace = edit(loadProductMix(), (model) =>
      removeConstraint(model, "labor"),
    );
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(
      scene.definition.resources.map((node) => node.constraintId),
    ).toEqual(["machine", "packaging"]);
    expect(
      scene.definition.consumptions.some(
        (consumption) => consumption.constraintId === "labor",
      ),
    ).toBe(false);
  });

  it("does not turn a new unbound constraint into a resource", () => {
    const workspace = edit(loadProductMix(), addConstraint);
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(scene.definition.resources).toHaveLength(3);
    expect(scene.definition.unboundCount).toBe(1);
  });

  it("follows renames without breaking the bindings", () => {
    let workspace = edit(loadProductMix(), (model) =>
      setVariableName(model, "x1", "Mesas"),
    );
    workspace = edit(workspace, (model) =>
      setConstraintName(model, "machine", "Torno"),
    );
    const scene = buildProductMixScene(workspace.model, workspace.scenario, null);

    expect(scene.definition.products[0]).toMatchObject({
      variableId: "x1",
      name: "Mesas",
    });
    expect(scene.definition.resources[0]).toMatchObject({
      constraintId: "machine",
      name: "Torno",
    });
    expect(scene.definition.consumptions[0]).toMatchObject({
      constraintId: "machine",
      variableId: "x1",
      coefficient: 2,
    });
  });

  it("represents nothing and counts everything as unbound without a scenario", () => {
    const { model } = loadProductMix();
    const scene = buildProductMixScene(model, null, null);

    expect(scene.definition.products).toEqual([]);
    expect(scene.definition.resources).toEqual([]);
    expect(scene.definition.consumptions).toEqual([]);
    expect(scene.definition.unboundCount).toBe(5);
  });
});

describe("product quantities", () => {
  it("normalizes very large values while keeping the true quantity", () => {
    const result: OptimizationResult = {
      ...optimal,
      objectiveValue: 2_000_750,
      variableValues: [
        { variableId: "x1", value: 50_000 },
        { variableId: "x2", value: 25 },
      ],
    };
    const scene = solvedScene(loadProductMix(), result);
    const layout = layoutProductMixScene(scene);

    expect(scene.solution).toMatchObject({
      products: [
        { quantity: 50_000, normalized: 1 },
        { quantity: 25, normalized: 0.0005 },
      ],
    });
    expect(layout.products[0].height).toBe(FLOOR.productMaxHeight);
    // A positive amount stays distinguishable from zero.
    expect(layout.products[1].height).toBe(FLOOR.productMinHeight);
  });

  it("draws zero quantities with no height but keeps their value", () => {
    const result: OptimizationResult = {
      ...optimal,
      objectiveValue: 0,
      variableValues: [
        { variableId: "x1", value: 0 },
        { variableId: "x2", value: 0 },
      ],
      constraints: optimal.constraints.map((row) => ({
        ...row,
        activity: 0,
        slack: row.rhs,
        active: false,
      })),
    };
    const scene = solvedScene(loadProductMix(), result);
    const layout = layoutProductMixScene(scene);

    expect(scene.solution).toMatchObject({
      products: [
        { quantity: 0, normalized: 0 },
        { quantity: 0, normalized: 0 },
      ],
    });
    expect(layout.products.map((placed) => placed.height)).toEqual([0, 0]);
    expect(layout.resources.map((placed) => placed.segments)).toEqual([[], [], []]);
  });

  it("gives no height to a negative or non-finite amount", () => {
    expect(normalizeAmount(-3, 10)).toBe(0);
    expect(normalizeAmount(5, 0)).toBe(0);
    expect(normalizeAmount(5, Number.POSITIVE_INFINITY)).toBe(0);
    expect(productHeight(null)).toBe(0);
  });
});

describe("non-optimal results", () => {
  it.each(["infeasible", "unbounded"] as const)(
    "keeps the system but shows no solution data when %s",
    (status) => {
      const scene = solvedScene(loadProductMix(), emptyResult(status));
      const layout = layoutProductMixScene(scene);

      expect(scene.solution).toEqual({ state: status });
      expect(scene.definition.products).toHaveLength(2);
      expect(scene.definition.resources).toHaveLength(3);
      expect(scene.definition.consumptions).toHaveLength(6);
      expect(layout.products.every((placed) => placed.state === null)).toBe(true);
      expect(layout.resources.every((placed) => placed.fillHeight === 0)).toBe(true);
    },
  );

  it("carries the technical message of a solver error", () => {
    const scene = solvedScene(
      loadProductMix(),
      emptyResult("error", "HiGHS status kUnboundedOrInfeasible"),
    );

    expect(scene.solution).toEqual({
      state: "error",
      message: "HiGHS status kUnboundedOrInfeasible",
    });
  });
});

describe("floor layout", () => {
  it("places entities in centred rows that do not depend on values", () => {
    expect(rowPositions(3, 2)).toEqual([-2, 0, 2]);
    expect(rowPositions(1, 2)).toEqual([0]);
    expect(rowPositions(0, 2)).toEqual([]);
  });

  it("stacks the use of each product inside its vessel", () => {
    const layout = layoutProductMixScene(solvedScene(loadProductMix(), optimal));
    const [machine, labor, packaging] = layout.resources;
    const h = FLOOR.vesselHeight;

    expect(machine.segments).toEqual([
      { variableId: "x1", bottom: 0, top: 0.8 * h },
      { variableId: "x2", bottom: 0.8 * h, top: h },
    ]);
    expect(labor.segments.map((segment) => segment.top)).toEqual([0.5 * h, h]);
    expect(packaging.fillHeight).toBeCloseTo(0.6 * h);
    expect(packaging.segments.at(-1)!.top).toBeCloseTo(0.6 * h);
  });

  it("compares channel widths only within a resource", () => {
    const layout = layoutProductMixScene(
      buildProductMixScene(loadProductMix().model, template.scenario, null),
    );
    const width = (constraintId: string, variableId: string) =>
      layout.channels.find(
        (channel) =>
          channel.consumption.constraintId === constraintId &&
          channel.consumption.variableId === variableId,
      )!.width;

    expect(layout.channels).toHaveLength(6);
    expect(width("machine", "x1")).toBe(FLOOR.channelMaxWidth);
    expect(width("machine", "x2")).toBeCloseTo(
      channelWidth(1, 2),
    );
    // Packaging uses 1 of each: both are the largest within that resource.
    expect(width("packaging", "x1")).toBe(FLOOR.channelMaxWidth);
    expect(width("packaging", "x2")).toBe(FLOOR.channelMaxWidth);
  });

  it("keeps every coordinate finite and inside the platform", () => {
    const layout = layoutProductMixScene(solvedScene(loadProductMix(), optimal));

    for (const placed of [...layout.resources, ...layout.products]) {
      expect(Math.abs(placed.x)).toBeLessThan(layout.platform.width / 2);
      expect(Math.abs(placed.z - layout.platform.centerZ)).toBeLessThan(
        layout.platform.depth / 2,
      );
    }
    expect(Number.isFinite(layout.radius)).toBe(true);
    expect(vesselFill(1.2)).toBe(FLOOR.vesselHeight);
    expect(vesselFill(null)).toBe(0);
  });

  it("still produces a bounded floor when nothing is represented", () => {
    const layout = layoutProductMixScene(
      buildProductMixScene(loadProductMix().model, null, null),
    );

    expect(layout.platform.width).toBeGreaterThan(0);
    expect(Number.isFinite(layout.radius)).toBe(true);
  });
});
