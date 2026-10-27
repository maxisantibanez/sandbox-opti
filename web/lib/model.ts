export type ObjectiveSense = "maximize" | "minimize";
export type VariableType = "continuous";
export type ConstraintOperator = "<=" | ">=" | "=";
export type SolveStatus = "optimal" | "infeasible" | "unbounded" | "error";

export interface Term {
  variableId: string;
  coefficient: number;
}

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  lowerBound: number | null;
  upperBound: number | null;
}

export interface Objective {
  sense: ObjectiveSense;
  terms: Term[];
}

export interface Constraint {
  id: string;
  name: string;
  terms: Term[];
  operator: ConstraintOperator;
  rhs: number;
}

export interface OptimizationModel {
  variables: Variable[];
  objective: Objective;
  constraints: Constraint[];
}

export interface VariableValue {
  variableId: string;
  value: number;
}

export interface ConstraintResult {
  constraintId: string;
  activity: number;
  rhs: number;
  slack: number;
  active: boolean;
}

export interface OptimizationResult {
  status: SolveStatus;
  objectiveValue: number | null;
  variableValues: VariableValue[];
  constraints: ConstraintResult[];
  message: string | null;
}
