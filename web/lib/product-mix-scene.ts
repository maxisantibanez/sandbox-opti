import type {
  ConstraintOperator,
  ObjectiveSense,
  OptimizationModel,
  OptimizationResult,
} from "./model";
import {
  constraintRole,
  variableRole,
  type ScenarioDefinition,
} from "./scenario";

// Scene adapter for the Product Mix scenario. It reads the modelled system
// from three sources and keeps them apart:
//
//   ScenarioDefinition  → what each entity means (product, resource)
//   OptimizationModel   → how the entities relate (coefficients, capacities)
//   OptimizationResult  → which solution the solver produced
//
// `definition` exists before solving and changes with every edit. `solution`
// is added only by a result that belongs to the current model object. The
// adapter never solves, never invents values and contains nothing visual:
// world units live in product-mix-layout.ts. See docs/SCENARIO_3D.md.

/** The last solver result together with the exact model snapshot it solved. */
export interface SolvedSnapshot {
  model: OptimizationModel;
  result: OptimizationResult;
}

export interface ProductNode {
  variableId: string;
  /** The variable name in the model: the label follows renames. */
  name: string;
  /** Coefficient of the variable in the objective; 0 when it has no term. */
  objectiveCoefficient: number;
  lowerBound: number | null;
  upperBound: number | null;
  /** The domain only admits non-negative quantities (lowerBound ≥ 0). */
  nonNegative: boolean;
}

export type CapacityIssue =
  /** The relation is not `activity <= capacity`. */
  | "operator"
  /** A capacity cannot be negative. */
  | "negative-capacity"
  /** A represented product would release the resource instead of using it. */
  | "negative-consumption"
  /** A product that uses the resource may take negative quantities. */
  | "product-domain";

export interface ResourceNode {
  constraintId: string;
  name: string;
  operator: ConstraintOperator;
  /** The right-hand side of the constraint, read from the model. */
  capacity: number;
  /**
   * Issues that prevent reading the constraint as a capacity. Empty means
   * the resource is interpretable; otherwise it is shown as a plain relation.
   */
  capacityIssues: CapacityIssue[];
  /** Variables without semantics that also appear in this constraint. */
  unrepresentedVariableIds: string[];
}

/** A represented product that appears in a resource constraint. */
export interface Consumption {
  constraintId: string;
  variableId: string;
  /** Units of the resource used per unit of the product: the model coefficient. */
  coefficient: number;
  /**
   * capacity / coefficient: the largest quantity of this product this
   * resource alone would allow. Not a global maximum, since other
   * constraints also apply. Null when the reading does not hold.
   */
  resourceLimit: number | null;
}

export interface SystemDefinition {
  objectiveSense: ObjectiveSense;
  products: ProductNode[];
  resources: ResourceNode[];
  consumptions: Consumption[];
  /** Variables and constraints that have no binding in the scenario. */
  unboundCount: number;
}

export interface ProductState {
  variableId: string;
  /** True value from HiGHS. */
  quantity: number;
  /** quantity / largest positive represented quantity, in [0, 1]. */
  normalized: number;
}

export interface ConsumptionShare {
  variableId: string;
  /** coefficient · quantity, an explanation of the solver activity. */
  amount: number;
}

export interface ResourceState {
  constraintId: string;
  /** Authoritative values from the backend. */
  activity: number;
  slack: number;
  active: boolean;
  /** activity / capacity; null when the resource is not an interpretable positive capacity. */
  utilization: number | null;
  /** Use of the resource by each represented product. */
  shares: ConsumptionShare[];
  /** Use by variables without semantics, summed. */
  unrepresentedAmount: number;
  /**
   * Whether the shares add up to `activity` within DECOMPOSITION_TOLERANCE.
   * When false the shares are kept for inspection but must not be drawn as
   * an explanation of the activity, and nothing is adjusted.
   */
  decompositionMatches: boolean;
}

export type SceneSolution =
  | { state: "unsolved" }
  /** A result exists, but for a model that is no longer the current one. */
  | { state: "stale" }
  | {
      state: "optimal";
      objectiveValue: number;
      products: ProductState[];
      resources: ResourceState[];
    }
  | { state: "infeasible" }
  | { state: "unbounded" }
  | { state: "error"; message: string | null };

export interface ProductMixScene {
  definition: SystemDefinition;
  solution: SceneSolution;
}

export function buildProductMixScene(
  model: OptimizationModel,
  scenario: ScenarioDefinition | null,
  solved: SolvedSnapshot | null,
): ProductMixScene {
  const definition = buildDefinition(model, scenario);
  return { definition, solution: buildSolution(model, definition, solved) };
}

/** The modelled system: it exists before solving and needs no result. */
export function buildDefinition(
  model: OptimizationModel,
  scenario: ScenarioDefinition | null,
): SystemDefinition {
  const objectiveCoefficients = new Map(
    model.objective.terms.map((term) => [term.variableId, term.coefficient]),
  );

  const products: ProductNode[] = model.variables
    .filter((variable) => variableRole(scenario, variable.id) === "product")
    .map((variable) => ({
      variableId: variable.id,
      name: variable.name,
      objectiveCoefficient: objectiveCoefficients.get(variable.id) ?? 0,
      lowerBound: variable.lowerBound,
      upperBound: variable.upperBound,
      nonNegative: variable.lowerBound !== null && variable.lowerBound >= 0,
    }));
  const productsById = new Map(
    products.map((product) => [product.variableId, product]),
  );

  const resourceConstraints = model.constraints.filter(
    (constraint) =>
      constraintRole(scenario, constraint.id) === "resource-capacity",
  );

  const resources: ResourceNode[] = resourceConstraints.map((constraint) => {
    const represented = constraint.terms.filter(
      (term) => term.coefficient !== 0 && productsById.has(term.variableId),
    );
    const issues: CapacityIssue[] = [];
    if (constraint.operator !== "<=") {
      issues.push("operator");
    }
    if (constraint.rhs < 0) {
      issues.push("negative-capacity");
    }
    if (represented.some((term) => term.coefficient < 0)) {
      issues.push("negative-consumption");
    }
    if (
      represented.some(
        (term) => !productsById.get(term.variableId)!.nonNegative,
      )
    ) {
      issues.push("product-domain");
    }

    return {
      constraintId: constraint.id,
      name: constraint.name,
      operator: constraint.operator,
      capacity: constraint.rhs,
      capacityIssues: issues,
      unrepresentedVariableIds: constraint.terms
        .filter(
          (term) =>
            term.coefficient !== 0 && !productsById.has(term.variableId),
        )
        .map((term) => term.variableId),
    };
  });
  const interpretable = new Set(
    resources
      .filter((resource) => resource.capacityIssues.length === 0)
      .map((resource) => resource.constraintId),
  );

  const consumptions: Consumption[] = resourceConstraints.flatMap(
    (constraint) =>
      constraint.terms
        .filter(
          (term) =>
            term.coefficient !== 0 && productsById.has(term.variableId),
        )
        .map((term) => ({
          constraintId: constraint.id,
          variableId: term.variableId,
          coefficient: term.coefficient,
          resourceLimit: interpretable.has(constraint.id)
            ? constraint.rhs / term.coefficient
            : null,
        })),
  );

  const unboundCount =
    model.variables.filter((variable) => !variableRole(scenario, variable.id))
      .length +
    model.constraints.filter(
      (constraint) => !constraintRole(scenario, constraint.id),
    ).length;

  return {
    objectiveSense: model.objective.sense,
    products,
    resources,
    consumptions,
    unboundCount,
  };
}

/**
 * A result only counts when it belongs to this very model object: every edit
 * creates a new model, so a result for an older one is reported as `stale`
 * and contributes no quantities, activity or active state.
 */
function buildSolution(
  model: OptimizationModel,
  definition: SystemDefinition,
  solved: SolvedSnapshot | null,
): SceneSolution {
  if (!solved) {
    return { state: "unsolved" };
  }
  if (solved.model !== model) {
    return { state: "stale" };
  }

  const { result } = solved;
  switch (result.status) {
    case "infeasible":
      return { state: "infeasible" };
    case "unbounded":
      return { state: "unbounded" };
    case "error":
      return { state: "error", message: result.message };
    case "optimal":
      break;
  }
  if (result.objectiveValue === null) {
    return { state: "error", message: result.message };
  }

  const quantities = new Map(
    result.variableValues.map((item) => [item.variableId, item.value]),
  );
  const rows = new Map(result.constraints.map((row) => [row.constraintId, row]));

  const represented = definition.products.filter((product) =>
    quantities.has(product.variableId),
  );
  const largest = Math.max(
    0,
    ...represented.map((product) => quantities.get(product.variableId)!),
  );
  const products = represented.map((product) => {
    const quantity = quantities.get(product.variableId)!;
    return {
      variableId: product.variableId,
      quantity,
      normalized: normalizeAmount(quantity, largest),
    };
  });

  const productIds = new Set(
    definition.products.map((product) => product.variableId),
  );
  const resources = definition.resources.flatMap((resource) => {
    const row = rows.get(resource.constraintId);
    const constraint = model.constraints.find(
      (candidate) => candidate.id === resource.constraintId,
    );
    if (!row || !constraint) {
      return [];
    }

    const contributions = constraint.terms.map((term) => ({
      variableId: term.variableId,
      amount: term.coefficient * (quantities.get(term.variableId) ?? 0),
    }));
    const shares = contributions.filter(
      (share) => productIds.has(share.variableId) && share.amount !== 0,
    );
    const unrepresentedAmount = contributions
      .filter((share) => !productIds.has(share.variableId))
      .reduce((sum, share) => sum + share.amount, 0);

    return [
      {
        constraintId: resource.constraintId,
        activity: row.activity,
        slack: row.slack,
        active: row.active,
        utilization: utilization(resource, row.activity),
        shares,
        unrepresentedAmount,
        decompositionMatches: decompositionMatches(
          contributions.map((share) => share.amount),
          row.activity,
        ),
      },
    ];
  });

  return {
    state: "optimal",
    objectiveValue: result.objectiveValue,
    products,
    resources,
  };
}

/**
 * Share of the largest positive represented quantity. Quantities are drawn
 * relative to each other; the true number always travels with the label.
 * Zero and negative values have no height.
 */
export function normalizeAmount(value: number, largest: number): number {
  if (!(value > 0) || !(largest > 0) || !Number.isFinite(largest)) {
    return 0;
  }
  return Math.min(1, value / largest);
}

/**
 * activity / capacity for an interpretable resource with a positive capacity.
 * Zero capacity, or any issue with the capacity reading, gives null instead of
 * an infinite or misleading percentage.
 */
export function utilization(
  resource: ResourceNode,
  activity: number,
): number | null {
  if (
    resource.capacityIssues.length > 0 ||
    !(resource.capacity > 0) ||
    !Number.isFinite(activity)
  ) {
    return null;
  }
  return Math.max(0, activity) / resource.capacity;
}

/**
 * Relative tolerance between the backend activity and the sum of
 * coefficient · quantity. It mirrors the solver's `active` tolerance
 * (MODEL_SPEC §5), scaled by the largest magnitude involved so that
 * cancelling terms are not judged against a tiny total.
 */
export const DECOMPOSITION_TOLERANCE = 1e-7;

export function decompositionMatches(
  amounts: number[],
  activity: number,
): boolean {
  const sum = amounts.reduce((total, amount) => total + amount, 0);
  const scale = Math.max(
    1,
    Math.abs(activity),
    ...amounts.map((amount) => Math.abs(amount)),
  );
  return (
    Number.isFinite(sum) &&
    Math.abs(sum - activity) <= DECOMPOSITION_TOLERANCE * scale
  );
}
