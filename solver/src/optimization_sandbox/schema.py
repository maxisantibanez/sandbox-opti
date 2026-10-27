"""Canonical data contract for optimization models and results.

The JSON shape of these models is the public API contract. See docs/MODEL_SPEC.md.
"""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

CONTRACT_CONFIG = ConfigDict(
    populate_by_name=True,
    extra="forbid",
    allow_inf_nan=False,
)


class ObjectiveSense(str, Enum):
    maximize = "maximize"
    minimize = "minimize"


class VariableType(str, Enum):
    continuous = "continuous"


class ConstraintOperator(str, Enum):
    less_than_or_equal = "<="
    greater_than_or_equal = ">="
    equal = "="


class SolveStatus(str, Enum):
    optimal = "optimal"
    infeasible = "infeasible"
    unbounded = "unbounded"
    error = "error"


class Term(BaseModel):
    model_config = CONTRACT_CONFIG

    variable_id: str = Field(alias="variableId", min_length=1)
    coefficient: float


class Variable(BaseModel):
    model_config = CONTRACT_CONFIG

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    type: VariableType
    lower_bound: float | None = Field(alias="lowerBound")
    upper_bound: float | None = Field(alias="upperBound")


class Objective(BaseModel):
    model_config = CONTRACT_CONFIG

    sense: ObjectiveSense
    terms: list[Term] = Field(min_length=1)


class Constraint(BaseModel):
    model_config = CONTRACT_CONFIG

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    terms: list[Term] = Field(min_length=1)
    operator: ConstraintOperator
    rhs: float


class OptimizationModel(BaseModel):
    model_config = CONTRACT_CONFIG

    variables: list[Variable] = Field(min_length=1)
    objective: Objective
    constraints: list[Constraint] = Field(default_factory=list)


class VariableValue(BaseModel):
    model_config = CONTRACT_CONFIG

    variable_id: str = Field(alias="variableId")
    value: float


class ConstraintResult(BaseModel):
    model_config = CONTRACT_CONFIG

    constraint_id: str = Field(alias="constraintId")
    activity: float
    rhs: float
    slack: float
    active: bool


class OptimizationResult(BaseModel):
    model_config = CONTRACT_CONFIG

    status: SolveStatus
    objective_value: float | None = Field(default=None, alias="objectiveValue")
    variable_values: list[VariableValue] = Field(default_factory=list, alias="variableValues")
    constraints: list[ConstraintResult] = Field(default_factory=list)
    message: str | None = None
