import type { OptimizationModel } from "./model";

/**
 * Minimal editable model without semantics: Max Z = x₁ + x₂ with both variables
 * non-negative and no constraints. Two variables keep the Geometric View
 * available from the start. Contract-valid: constraints may be empty.
 */
export function createBlankModel(): OptimizationModel {
  return {
    variables: [
      { id: "x1", name: "x₁", type: "continuous", lowerBound: 0, upperBound: null },
      { id: "x2", name: "x₂", type: "continuous", lowerBound: 0, upperBound: null },
    ],
    objective: {
      sense: "maximize",
      terms: [
        { variableId: "x1", coefficient: 1 },
        { variableId: "x2", coefficient: 1 },
      ],
    },
    constraints: [],
  };
}
