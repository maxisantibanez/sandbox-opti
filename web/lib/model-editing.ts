import type {
  Constraint,
  ConstraintOperator,
  ObjectiveSense,
  OptimizationModel,
  Term,
  Variable,
} from "./model";

export function setObjectiveSense(
  model: OptimizationModel,
  sense: ObjectiveSense,
): OptimizationModel {
  return {
    ...model,
    objective: { ...model.objective, sense },
  };
}

export function setObjectiveCoefficient(
  model: OptimizationModel,
  variableId: string,
  coefficient: number,
): OptimizationModel {
  return {
    ...model,
    objective: {
      ...model.objective,
      terms: model.objective.terms.map((term) =>
        term.variableId === variableId ? { ...term, coefficient } : term,
      ),
    },
  };
}

export function setConstraintCoefficient(
  model: OptimizationModel,
  constraintId: string,
  variableId: string,
  coefficient: number,
): OptimizationModel {
  return updateConstraint(model, constraintId, (constraint) => ({
    ...constraint,
    terms: constraint.terms.map((term) =>
      term.variableId === variableId ? { ...term, coefficient } : term,
    ),
  }));
}

export function setConstraintOperator(
  model: OptimizationModel,
  constraintId: string,
  operator: ConstraintOperator,
): OptimizationModel {
  return updateConstraint(model, constraintId, (constraint) => ({
    ...constraint,
    operator,
  }));
}

export function setConstraintRhs(
  model: OptimizationModel,
  constraintId: string,
  rhs: number,
): OptimizationModel {
  return updateConstraint(model, constraintId, (constraint) => ({
    ...constraint,
    rhs,
  }));
}

function updateConstraint(
  model: OptimizationModel,
  constraintId: string,
  update: (constraint: Constraint) => Constraint,
): OptimizationModel {
  return {
    ...model,
    constraints: model.constraints.map((constraint) =>
      constraint.id === constraintId ? update(constraint) : constraint,
    ),
  };
}

function updateVariable(
  model: OptimizationModel,
  variableId: string,
  update: (variable: Variable) => Variable,
): OptimizationModel {
  return {
    ...model,
    variables: model.variables.map((variable) =>
      variable.id === variableId ? update(variable) : variable,
    ),
  };
}

// ---------------------------------------------------------------------------
// M2B — structural operations
//
// Every operation returns a new OptimizationModel and never leaves the model
// in a state the backend contract would reject. When an operation cannot be
// applied (unknown reference, duplicate term, contract minimum) the SAME model
// object is returned: a no-op must not mark solved results as stale.
// ---------------------------------------------------------------------------

const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

/**
 * Appends a new continuous, non-negative variable. The variable starts without
 * terms: it shows up in the domain line and in the "add term" selectors of
 * every expression, where the user decides where it belongs.
 */
export function addVariable(model: OptimizationModel): OptimizationModel {
  const id = nextNumberedId(
    model.variables.map((variable) => variable.id),
    "x",
  );

  const variable: Variable = {
    id,
    name: subscriptName(id),
    type: "continuous",
    lowerBound: 0,
    upperBound: null,
  };

  return {
    ...model,
    variables: [...model.variables, variable],
  };
}

/**
 * Removes a variable and every term that references it. Constraints left
 * without terms disappear with it, so the model always stays valid.
 *
 * Returns the same model object (no change, no staleness) when the removal
 * would break the contract: the model needs at least one variable and the
 * objective needs at least one term.
 */
export function removeVariable(
  model: OptimizationModel,
  variableId: string,
): OptimizationModel {
  if (model.variables.length <= 1) {
    return model;
  }
  if (model.objective.terms.every((term) => term.variableId === variableId)) {
    return model;
  }

  const variables = model.variables.filter(
    (variable) => variable.id !== variableId,
  );
  if (variables.length === model.variables.length) {
    return model;
  }

  return {
    ...model,
    variables,
    objective: {
      ...model.objective,
      terms: model.objective.terms.filter(
        (term) => term.variableId !== variableId,
      ),
    },
    constraints: model.constraints
      .map((constraint) => ({
        ...constraint,
        terms: constraint.terms.filter(
          (term) => term.variableId !== variableId,
        ),
      }))
      .filter((constraint) => constraint.terms.length > 0),
  };
}

/** Renames a variable without touching its stable id. Blank names are refused. */
export function setVariableName(
  model: OptimizationModel,
  variableId: string,
  name: string,
): OptimizationModel {
  const trimmed = name.trim();
  const variable = model.variables.find(
    (candidate) => candidate.id === variableId,
  );
  if (!variable || !trimmed || trimmed === variable.name) {
    return model;
  }

  return updateVariable(model, variableId, (current) => ({
    ...current,
    name: trimmed,
  }));
}

/** Renames a constraint without touching its stable id. Blank names are refused. */
export function setConstraintName(
  model: OptimizationModel,
  constraintId: string,
  name: string,
): OptimizationModel {
  const trimmed = name.trim();
  const constraint = model.constraints.find(
    (candidate) => candidate.id === constraintId,
  );
  if (!constraint || !trimmed || trimmed === constraint.name) {
    return model;
  }

  return updateConstraint(model, constraintId, (current) => ({
    ...current,
    name: trimmed,
  }));
}

/** Adds `1·variable` as the last objective term. */
export function addObjectiveTerm(
  model: OptimizationModel,
  variableId: string,
): OptimizationModel {
  if (!isAvailableTermVariable(model.variables, model.objective.terms, variableId)) {
    return model;
  }

  return {
    ...model,
    objective: {
      ...model.objective,
      terms: [...model.objective.terms, { variableId, coefficient: 1 }],
    },
  };
}

/**
 * Removes one objective term. The objective must keep at least one term, so
 * removing the last one changes nothing.
 */
export function removeObjectiveTerm(
  model: OptimizationModel,
  variableId: string,
): OptimizationModel {
  if (model.objective.terms.length <= 1) {
    return model;
  }
  if (!hasTerm(model.objective.terms, variableId)) {
    return model;
  }

  return {
    ...model,
    objective: {
      ...model.objective,
      terms: model.objective.terms.filter(
        (term) => term.variableId !== variableId,
      ),
    },
  };
}

/**
 * Appends a new constraint seeded with `1·firstVariable <= 0`. The contract
 * requires at least one term per constraint, so a fresh row is born with an
 * editable seed instead of an invalid empty one.
 */
export function addConstraint(model: OptimizationModel): OptimizationModel {
  const firstVariable = model.variables[0];
  if (!firstVariable) {
    return model;
  }

  const constraint: Constraint = {
    id: nextNumberedId(
      model.constraints.map((candidate) => candidate.id),
      "constraint",
    ),
    name: `Restricción ${model.constraints.length + 1}`,
    terms: [{ variableId: firstVariable.id, coefficient: 1 }],
    operator: "<=",
    rhs: 0,
  };

  return {
    ...model,
    constraints: [...model.constraints, constraint],
  };
}

export function removeConstraint(
  model: OptimizationModel,
  constraintId: string,
): OptimizationModel {
  if (!hasConstraint(model, constraintId)) {
    return model;
  }

  return {
    ...model,
    constraints: model.constraints.filter(
      (constraint) => constraint.id !== constraintId,
    ),
  };
}

/** Adds `1·variable` as the last term of a constraint. */
export function addConstraintTerm(
  model: OptimizationModel,
  constraintId: string,
  variableId: string,
): OptimizationModel {
  const constraint = model.constraints.find(
    (candidate) => candidate.id === constraintId,
  );
  if (
    !constraint ||
    !isAvailableTermVariable(model.variables, constraint.terms, variableId)
  ) {
    return model;
  }

  return updateConstraint(model, constraintId, (current) => ({
    ...current,
    terms: [...current.terms, { variableId, coefficient: 1 }],
  }));
}

/**
 * Removes one term of a constraint. The constraint must keep at least one
 * term, so removing the last one changes nothing.
 */
export function removeConstraintTerm(
  model: OptimizationModel,
  constraintId: string,
  variableId: string,
): OptimizationModel {
  const constraint = model.constraints.find(
    (candidate) => candidate.id === constraintId,
  );
  if (
    !constraint ||
    constraint.terms.length <= 1 ||
    !hasTerm(constraint.terms, variableId)
  ) {
    return model;
  }

  return updateConstraint(model, constraintId, (current) => ({
    ...current,
    terms: current.terms.filter((term) => term.variableId !== variableId),
  }));
}

function isAvailableTermVariable(
  variables: Variable[],
  terms: Term[],
  variableId: string,
): boolean {
  return (
    variables.some((variable) => variable.id === variableId) &&
    !hasTerm(terms, variableId)
  );
}

function hasTerm(terms: Term[], variableId: string): boolean {
  return terms.some((term) => term.variableId === variableId);
}

function hasConstraint(
  model: OptimizationModel,
  constraintId: string,
): boolean {
  return model.constraints.some(
    (constraint) => constraint.id === constraintId,
  );
}

/** Next free `prefix<N>` id, scanning every existing id. */
function nextNumberedId(existingIds: string[], prefix: string): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const id of existingIds) {
    const match = pattern.exec(id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }

  const used = new Set(existingIds);
  let next = max + 1;
  while (used.has(`${prefix}${next}`)) {
    next += 1;
  }
  return `${prefix}${next}`;
}

/** Presentation name for a generated `x<N>` id, e.g. `x3` → `x₃`. */
function subscriptName(id: string): string {
  const digits = id.slice(1);
  const subscript = [...digits]
    .map((digit) => SUBSCRIPT_DIGITS[Number(digit)] ?? digit)
    .join("");
  return `x${subscript}`;
}
