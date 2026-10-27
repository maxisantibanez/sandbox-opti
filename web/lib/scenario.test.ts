import { describe, expect, it } from "vitest";

import { createBlankModel } from "./blank-model";
import type { OptimizationModel } from "./model";
import {
  addConstraint,
  addVariable,
  removeConstraint,
  removeConstraintTerm,
  removeVariable,
  setVariableName,
} from "./model-editing";
import {
  constraintRole,
  pruneScenario,
  roleLabel,
  variableRole,
  type ScenarioDefinition,
} from "./scenario";
import { TEMPLATES } from "./templates";

const productMixTemplate = TEMPLATES.find(
  (template) => template.scenario.metadata.id === "product-mix",
);
if (!productMixTemplate) {
  throw new Error("Product Mix template is missing.");
}

function loadProductMix(): {
  model: OptimizationModel;
  scenario: ScenarioDefinition;
} {
  return {
    model: structuredClone(productMixTemplate!.model),
    scenario: productMixTemplate!.scenario,
  };
}

describe("Product Mix template", () => {
  it("binds every variable and constraint to an existing stable id", () => {
    const { model, scenario } = loadProductMix();
    const variableIds = model.variables.map((variable) => variable.id);
    const constraintIds = model.constraints.map((constraint) => constraint.id);

    expect(scenario.variableBindings.map((binding) => binding.variableId)).toEqual(
      ["x1", "x2"],
    );
    for (const binding of scenario.variableBindings) {
      expect(variableIds).toContain(binding.variableId);
    }
    for (const binding of scenario.constraintBindings) {
      expect(constraintIds).toContain(binding.constraintId);
    }
    expect(scenario.constraintBindings).toHaveLength(constraintIds.length);
  });

  it("keeps the mathematics of the original fixture unchanged", () => {
    const { model } = loadProductMix();

    expect(model.variables.map((variable) => variable.name)).toEqual([
      "Producto A",
      "Producto B",
    ]);
    expect(model.objective.terms).toEqual([
      { variableId: "x1", coefficient: 40 },
      { variableId: "x2", coefficient: 30 },
    ]);
    expect(model.constraints.map((constraint) => constraint.rhs)).toEqual([
      100, 80, 100,
    ]);
  });

  it("describes itself with metadata and readable role labels", () => {
    const { scenario } = loadProductMix();

    expect(scenario.metadata).toMatchObject({
      id: "product-mix",
      name: "Product Mix",
      category: "production",
    });
    expect(roleLabel("product")).toBe("producto");
    expect(roleLabel("resource-capacity")).toBe("recurso");
  });

  it("stores bindings as id plus role, never as names or labels", () => {
    const { scenario } = loadProductMix();
    const bindings = [
      ...scenario.variableBindings,
      ...scenario.constraintBindings,
    ];

    for (const binding of bindings) {
      expect(Object.keys(binding).sort()).toEqual(
        "variableId" in binding ? ["role", "variableId"] : ["constraintId", "role"],
      );
    }
  });
});

describe("binding lookups", () => {
  it("resolves roles by id regardless of renaming or array order", () => {
    let { model } = loadProductMix();
    const { scenario } = loadProductMix();

    model = setVariableName(model, "x1", "Mesas");
    model.variables.reverse();

    expect(variableRole(scenario, "x1")).toBe("product");
    expect(constraintRole(scenario, "machine")).toBe("resource-capacity");
  });

  it("treats unknown ids and a missing scenario as unbound without throwing", () => {
    const { scenario } = loadProductMix();

    expect(variableRole(scenario, "x99")).toBeNull();
    expect(constraintRole(scenario, "constraint99")).toBeNull();
    expect(variableRole(null, "x1")).toBeNull();
    expect(constraintRole(null, "machine")).toBeNull();
  });
});

describe("binding lifecycle", () => {
  it("keeps the same scenario object when nothing was removed", () => {
    const { model, scenario } = loadProductMix();

    expect(pruneScenario(scenario, model)).toBe(scenario);
    expect(pruneScenario(null, model)).toBeNull();
  });

  it("drops the binding of a removed variable and keeps the rest", () => {
    const { scenario } = loadProductMix();
    const model = removeVariable(loadProductMix().model, "x2");

    const pruned = pruneScenario(scenario, model);

    expect(pruned?.variableBindings).toEqual([
      { variableId: "x1", role: "product" },
    ]);
    expect(pruned?.constraintBindings).toEqual(scenario.constraintBindings);
    expect(scenario.variableBindings).toHaveLength(2);
  });

  it("drops the binding of a removed constraint", () => {
    const { scenario } = loadProductMix();
    const model = removeConstraint(loadProductMix().model, "labor");

    const pruned = pruneScenario(scenario, model);

    expect(pruned?.constraintBindings.map((binding) => binding.constraintId)).toEqual(
      ["machine", "packaging"],
    );
  });

  it("drops constraint bindings emptied by a variable removal", () => {
    let model = loadProductMix().model;
    model = removeConstraintTerm(model, "packaging", "x2");
    model = removeVariable(model, "x1");

    const pruned = pruneScenario(loadProductMix().scenario, model);

    // The packaging row lost its last term, so the cascade removed it.
    expect(model.constraints.map((constraint) => constraint.id)).toEqual([
      "machine",
      "labor",
    ]);
    expect(pruned?.constraintBindings.map((binding) => binding.constraintId)).toEqual(
      ["machine", "labor"],
    );
  });

  it("never lets a reused id inherit a removed binding", () => {
    const { scenario } = loadProductMix();
    let model = removeVariable(loadProductMix().model, "x2");
    const pruned = pruneScenario(scenario, model) ?? scenario;

    // x2 is the highest numbered id, so the next generated variable reuses it.
    model = addVariable(model);

    expect(model.variables.map((variable) => variable.id)).toEqual(["x1", "x2"]);
    expect(variableRole(pruned, "x2")).toBeNull();
    expect(variableRole(pruned, "x1")).toBe("product");
  });

  it("leaves variables and constraints created later without a meaning", () => {
    const { scenario } = loadProductMix();
    let model = addVariable(loadProductMix().model);
    model = addConstraint(model);

    expect(variableRole(scenario, "x3")).toBeNull();
    expect(constraintRole(scenario, "constraint1")).toBeNull();
    expect(pruneScenario(scenario, model)).toBe(scenario);
  });
});

describe("blank model", () => {
  it("starts with two non-negative variables, a maximization and no constraints", () => {
    const model = createBlankModel();

    expect(model.variables.map((variable) => variable.id)).toEqual(["x1", "x2"]);
    expect(model.variables.every((variable) => variable.lowerBound === 0)).toBe(true);
    expect(model.objective).toEqual({
      sense: "maximize",
      terms: [
        { variableId: "x1", coefficient: 1 },
        { variableId: "x2", coefficient: 1 },
      ],
    });
    expect(model.constraints).toEqual([]);
  });

  it("carries no scenario semantics", () => {
    expect(pruneScenario(null, createBlankModel())).toBeNull();
  });
});
