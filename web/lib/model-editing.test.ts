import { describe, expect, it } from "vitest";

import type { OptimizationModel } from "./model";
import {
  addConstraint,
  addConstraintTerm,
  addObjectiveTerm,
  addVariable,
  removeConstraint,
  removeConstraintTerm,
  removeObjectiveTerm,
  removeVariable,
  setConstraintCoefficient,
  setConstraintOperator,
  setConstraintRhs,
  setConstraintName,
  setObjectiveCoefficient,
  setObjectiveSense,
  setVariableName,
} from "./model-editing";
import { TEMPLATES } from "./templates";

const productMix = TEMPLATES[0].model;

function cloneModel(): OptimizationModel {
  return structuredClone(productMix);
}

describe("model editing", () => {
  it("changes the objective sense without mutating the previous model", () => {
    const model = cloneModel();

    const edited = setObjectiveSense(model, "minimize");

    expect(edited.objective.sense).toBe("minimize");
    expect(model.objective.sense).toBe("maximize");
    expect(edited).not.toBe(model);
  });

  it("changes only the targeted objective coefficient", () => {
    const model = cloneModel();

    const edited = setObjectiveCoefficient(model, "x1", 50);

    expect(edited.objective.terms).toEqual([
      { variableId: "x1", coefficient: 50 },
      { variableId: "x2", coefficient: 30 },
    ]);
    expect(model.objective.terms[0].coefficient).toBe(40);
  });

  it("changes the targeted constraint coefficient", () => {
    const model = cloneModel();

    const edited = setConstraintCoefficient(model, "labor", "x2", 3);

    expect(edited.constraints[1].terms).toEqual([
      { variableId: "x1", coefficient: 1 },
      { variableId: "x2", coefficient: 3 },
    ]);
    expect(edited.constraints[0]).toBe(model.constraints[0]);
    expect(model.constraints[1].terms[1].coefficient).toBe(2);
  });

  it("changes only the targeted constraint operator", () => {
    const model = cloneModel();

    const edited = setConstraintOperator(model, "packaging", ">=");

    expect(edited.constraints.map((constraint) => constraint.operator)).toEqual([
      "<=",
      "<=",
      ">=",
    ]);
    expect(model.constraints[2].operator).toBe("<=");
  });

  it("changes only the targeted right-hand side", () => {
    const model = cloneModel();

    const edited = setConstraintRhs(model, "machine", 120);

    expect(edited.constraints.map((constraint) => constraint.rhs)).toEqual([
      120, 80, 100,
    ]);
    expect(model.constraints[0].rhs).toBe(100);
  });
});

describe("structural editing", () => {
  it("adds a variable with a generated id, subscript name and non-negative bounds", () => {
    const model = cloneModel();

    const edited = addVariable(model);

    expect(edited.variables.map((variable) => variable.id)).toEqual([
      "x1",
      "x2",
      "x3",
    ]);
    expect(edited.variables[2]).toEqual({
      id: "x3",
      name: "x₃",
      type: "continuous",
      lowerBound: 0,
      upperBound: null,
    });
    // Existing variables and expressions are untouched.
    expect(edited.variables[0]).toBe(model.variables[0]);
    expect(edited.objective).toBe(model.objective);
    expect(model.variables).toHaveLength(2);
  });

  it("generates sequential ids and subscript names", () => {
    let model = cloneModel();

    model = addVariable(model);
    model = addVariable(model);

    expect(model.variables.map((variable) => variable.id)).toEqual([
      "x1",
      "x2",
      "x3",
      "x4",
    ]);
    expect(model.variables.map((variable) => variable.name)).toEqual([
      "Producto A",
      "Producto B",
      "x₃",
      "x₄",
    ]);
  });

  it("reuses a freed variable slot after a removal", () => {
    let model = cloneModel();
    model = addVariable(model);
    model = removeVariable(model, "x3");
    model = addVariable(model);

    expect(model.variables.map((variable) => variable.id)).toEqual([
      "x1",
      "x2",
      "x3",
    ]);
  });

  it("starts numbering at x1 when no numbered variable exists", () => {
    const model = cloneModel();
    model.variables = [
      {
        id: "y",
        name: "y",
        type: "continuous",
        lowerBound: 0,
        upperBound: null,
      },
    ];

    const edited = addVariable(model);

    expect(edited.variables.map((variable) => variable.id)).toEqual(["y", "x1"]);
  });

  it("removes a variable and every term that references it", () => {
    const model = cloneModel();

    const edited = removeVariable(model, "x1");

    expect(edited.variables.map((variable) => variable.id)).toEqual(["x2"]);
    expect(edited.objective.terms).toEqual([
      { variableId: "x2", coefficient: 30 },
    ]);
    expect(edited.constraints.map((constraint) => constraint.terms)).toEqual([
      [{ variableId: "x2", coefficient: 1 }],
      [{ variableId: "x2", coefficient: 2 }],
      [{ variableId: "x2", coefficient: 1 }],
    ]);
    expect(model.variables).toHaveLength(2);
  });

  it("drops constraints left without terms when removing a variable", () => {
    let model = cloneModel();
    model = removeConstraintTerm(model, "packaging", "x2");

    const edited = removeVariable(model, "x1");

    expect(edited.constraints.map((constraint) => constraint.id)).toEqual([
      "machine",
      "labor",
    ]);
    expect(model.constraints).toHaveLength(3);
  });

  it("refuses to remove the only variable", () => {
    const model = cloneModel();
    model.variables = [model.variables[0]];
    model.objective.terms = [{ variableId: "x1", coefficient: 40 }];
    model.constraints = [
      {
        id: "machine",
        name: "Capacidad de máquina",
        terms: [{ variableId: "x1", coefficient: 2 }],
        operator: "<=",
        rhs: 100,
      },
    ];

    const edited = removeVariable(model, "x1");

    expect(edited).toBe(model);
  });

  it("refuses to remove the only variable referenced by the objective", () => {
    let model = cloneModel();
    model = removeObjectiveTerm(model, "x2");

    const edited = removeVariable(model, "x1");

    expect(edited).toBe(model);
    expect(edited.objective.terms).toEqual([
      { variableId: "x1", coefficient: 40 },
    ]);
  });

  it("ignores the removal of an unknown variable", () => {
    const model = cloneModel();

    expect(removeVariable(model, "x9")).toBe(model);
  });

  it("renames a variable without touching its id or terms", () => {
    const model = cloneModel();

    const edited = setVariableName(model, "x1", "Mesas");

    expect(edited.variables[0]).toEqual({
      id: "x1",
      name: "Mesas",
      type: "continuous",
      lowerBound: 0,
      upperBound: null,
    });
    expect(edited.objective.terms[0].variableId).toBe("x1");
  });

  it("refuses blank and unchanged variable names", () => {
    const model = cloneModel();

    expect(setVariableName(model, "x1", "   ")).toBe(model);
    expect(setVariableName(model, "x1", "Producto A")).toBe(model);
    expect(setVariableName(model, "x9", "Producto A")).toBe(model);
  });

  it("adds an objective term with coefficient 1", () => {
    let model = cloneModel();
    model = addVariable(model);

    const edited = addObjectiveTerm(model, "x3");

    expect(edited.objective.terms).toEqual([
      { variableId: "x1", coefficient: 40 },
      { variableId: "x2", coefficient: 30 },
      { variableId: "x3", coefficient: 1 },
    ]);
    expect(model.objective.terms).toHaveLength(2);
  });

  it("ignores duplicate or unknown objective terms", () => {
    const model = cloneModel();

    expect(addObjectiveTerm(model, "x1")).toBe(model);
    expect(addObjectiveTerm(model, "x9")).toBe(model);
  });

  it("removes an objective term", () => {
    const model = cloneModel();

    const edited = removeObjectiveTerm(model, "x1");

    expect(edited.objective.terms).toEqual([
      { variableId: "x2", coefficient: 30 },
    ]);
  });

  it("refuses to remove the last objective term", () => {
    let model = cloneModel();
    model = removeObjectiveTerm(model, "x1");

    expect(removeObjectiveTerm(model, "x2")).toBe(model);
  });

  it("appends a seeded constraint", () => {
    const model = cloneModel();

    const edited = addConstraint(model);

    expect(edited.constraints[3]).toEqual({
      id: "constraint1",
      name: "Restricción 4",
      terms: [{ variableId: "x1", coefficient: 1 }],
      operator: "<=",
      rhs: 0,
    });
    expect(model.constraints).toHaveLength(3);
  });

  it("generates sequential constraint ids", () => {
    let model = cloneModel();
    model = addConstraint(model);
    model = addConstraint(model);

    expect(model.constraints.map((constraint) => constraint.id)).toEqual([
      "machine",
      "labor",
      "packaging",
      "constraint1",
      "constraint2",
    ]);
    expect(model.constraints.map((constraint) => constraint.name)).toEqual([
      "Capacidad de máquina",
      "Mano de obra",
      "Empaque",
      "Restricción 4",
      "Restricción 5",
    ]);
  });

  it("removes the targeted constraint only", () => {
    const model = cloneModel();

    const edited = removeConstraint(model, "labor");

    expect(edited.constraints.map((constraint) => constraint.id)).toEqual([
      "machine",
      "packaging",
    ]);
    expect(model.constraints).toHaveLength(3);
  });

  it("ignores the removal of an unknown constraint", () => {
    const model = cloneModel();

    expect(removeConstraint(model, "constraint9")).toBe(model);
  });

  it("adds a term to a constraint with coefficient 1", () => {
    let model = cloneModel();
    model = addVariable(model);

    const edited = addConstraintTerm(model, "machine", "x3");

    expect(edited.constraints[0].terms).toEqual([
      { variableId: "x1", coefficient: 2 },
      { variableId: "x2", coefficient: 1 },
      { variableId: "x3", coefficient: 1 },
    ]);
    expect(model.constraints[0].terms).toHaveLength(2);
  });

  it("ignores duplicate, unknown or missing constraint terms", () => {
    const model = cloneModel();

    expect(addConstraintTerm(model, "machine", "x1")).toBe(model);
    expect(addConstraintTerm(model, "machine", "x9")).toBe(model);
    expect(addConstraintTerm(model, "constraint9", "x1")).toBe(model);
  });

  it("removes a constraint term", () => {
    const model = cloneModel();

    const edited = removeConstraintTerm(model, "machine", "x2");

    expect(edited.constraints[0].terms).toEqual([
      { variableId: "x1", coefficient: 2 },
    ]);
  });

  it("refuses to remove the last term of a constraint", () => {
    let model = cloneModel();
    model = removeConstraintTerm(model, "machine", "x2");

    expect(removeConstraintTerm(model, "machine", "x1")).toBe(model);
    expect(removeConstraintTerm(model, "machine", "x9")).toBe(model);
  });
});
