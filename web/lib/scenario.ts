import type { OptimizationModel } from "./model";

// ScenarioDefinition is semantic information about a model. It never contains
// math: bindings point to stable ids of OptimizationModel and are never sent to
// the solver. See docs/SCENARIOS.md.

export type VariableRole = "product";
export type ConstraintRole = "resource-capacity";

export interface ScenarioMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface VariableBinding {
  variableId: string;
  role: VariableRole;
}

export interface ConstraintBinding {
  constraintId: string;
  role: ConstraintRole;
}

export interface ScenarioDefinition {
  metadata: ScenarioMetadata;
  variableBindings: VariableBinding[];
  constraintBindings: ConstraintBinding[];
}

const ROLE_LABELS: Record<VariableRole | ConstraintRole, string> = {
  product: "producto",
  "resource-capacity": "recurso",
};

const CATEGORY_LABELS: Record<string, string> = {
  production: "Producción",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as VariableRole | ConstraintRole] ?? role;
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Role bound to a variable id, or null when the variable has no binding. */
export function variableRole(
  scenario: ScenarioDefinition | null,
  variableId: string,
): VariableRole | null {
  return (
    scenario?.variableBindings.find(
      (binding) => binding.variableId === variableId,
    )?.role ?? null
  );
}

/** Role bound to a constraint id, or null when the constraint has no binding. */
export function constraintRole(
  scenario: ScenarioDefinition | null,
  constraintId: string,
): ConstraintRole | null {
  return (
    scenario?.constraintBindings.find(
      (binding) => binding.constraintId === constraintId,
    )?.role ?? null
  );
}

/**
 * Drops every binding whose math entity no longer exists in the model. Runs on
 * each model change, because ids can be reused after a removal: a new variable
 * that receives a freed id must not inherit the old meaning.
 *
 * Returns the same scenario object when nothing was dropped, so unrelated
 * edits do not create new scenario state.
 */
export function pruneScenario(
  scenario: ScenarioDefinition | null,
  model: OptimizationModel,
): ScenarioDefinition | null {
  if (!scenario) {
    return null;
  }

  const variableIds = new Set(model.variables.map((variable) => variable.id));
  const constraintIds = new Set(
    model.constraints.map((constraint) => constraint.id),
  );
  const variableBindings = scenario.variableBindings.filter((binding) =>
    variableIds.has(binding.variableId),
  );
  const constraintBindings = scenario.constraintBindings.filter((binding) =>
    constraintIds.has(binding.constraintId),
  );

  if (
    variableBindings.length === scenario.variableBindings.length &&
    constraintBindings.length === scenario.constraintBindings.length
  ) {
    return scenario;
  }

  return { ...scenario, variableBindings, constraintBindings };
}
