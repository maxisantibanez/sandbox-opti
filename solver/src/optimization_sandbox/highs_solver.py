"""HiGHS adapter for the canonical optimization model."""

import logging
from math import fsum

import highspy

from .schema import (
    Constraint,
    ConstraintOperator,
    ConstraintResult,
    ObjectiveSense,
    OptimizationModel,
    OptimizationResult,
    SolveStatus,
    VariableValue,
)

logger = logging.getLogger(__name__)

# HiGHS primal feasibility tolerance is 1e-7 by default. Active constraints use a
# scale-aware version of the same tolerance.
RELATIVE_TOLERANCE = 1e-7

_NEGATIVE_INFINITY = -highspy.kHighsInf
_POSITIVE_INFINITY = highspy.kHighsInf


def solve_model(model: OptimizationModel) -> OptimizationResult:
    """Solve a valid model. Unexpected solver failures become an ``error`` result."""

    try:
        return _solve_with_highs(model)
    except Exception:
        logger.exception("Unexpected failure while solving the model")
        return OptimizationResult(
            status=SolveStatus.error,
            message="The solver failed unexpectedly.",
        )


def map_model_status(status: highspy.HighsModelStatus) -> SolveStatus:
    """Map HiGHS statuses to the four public result states."""

    if status == highspy.HighsModelStatus.kOptimal:
        return SolveStatus.optimal
    if status == highspy.HighsModelStatus.kInfeasible:
        return SolveStatus.infeasible
    if status == highspy.HighsModelStatus.kUnbounded:
        return SolveStatus.unbounded
    return SolveStatus.error


def _solve_with_highs(model: OptimizationModel) -> OptimizationResult:
    solver = highspy.Highs()
    solver.setOptionValue("output_flag", False)

    variable_index = {
        variable.id: index for index, variable in enumerate(model.variables)
    }

    for variable in model.variables:
        lower = (
            _NEGATIVE_INFINITY
            if variable.lower_bound is None
            else variable.lower_bound
        )
        upper = (
            _POSITIVE_INFINITY
            if variable.upper_bound is None
            else variable.upper_bound
        )
        _require_ok(solver.addVar(lower, upper), "add a variable")

    for term in model.objective.terms:
        _require_ok(
            solver.changeColCost(
                variable_index[term.variable_id],
                term.coefficient,
            ),
            "set an objective coefficient",
        )

    sense = (
        highspy.ObjSense.kMaximize
        if model.objective.sense == ObjectiveSense.maximize
        else highspy.ObjSense.kMinimize
    )
    _require_ok(solver.changeObjectiveSense(sense), "set the objective sense")

    for constraint in model.constraints:
        indices = [variable_index[term.variable_id] for term in constraint.terms]
        coefficients = [term.coefficient for term in constraint.terms]

        if constraint.operator == ConstraintOperator.less_than_or_equal:
            lower, upper = _NEGATIVE_INFINITY, constraint.rhs
        elif constraint.operator == ConstraintOperator.greater_than_or_equal:
            lower, upper = constraint.rhs, _POSITIVE_INFINITY
        else:
            lower = upper = constraint.rhs

        _require_ok(
            solver.addRow(lower, upper, len(indices), indices, coefficients),
            "add a constraint",
        )

    _require_ok(solver.run(), "solve the model")

    model_status = solver.getModelStatus()
    status = map_model_status(model_status)

    if status is SolveStatus.error:
        status_name = getattr(model_status, "name", str(model_status))
        return OptimizationResult(
            status=SolveStatus.error,
            message=f"HiGHS returned model status {status_name}.",
        )

    if status is not SolveStatus.optimal:
        return OptimizationResult(status=status)

    values = [float(value) for value in solver.getSolution().col_value]
    if len(values) != len(model.variables):
        raise RuntimeError("HiGHS returned a solution with an unexpected size.")

    values_by_id = {
        variable.id: value for variable, value in zip(model.variables, values)
    }

    return OptimizationResult(
        status=SolveStatus.optimal,
        objective_value=_normalize_zero(float(solver.getObjectiveValue())),
        variable_values=[
            VariableValue(variable_id=variable.id, value=_normalize_zero(value))
            for variable, value in zip(model.variables, values)
        ],
        constraints=[
            _evaluate_constraint(constraint, values_by_id)
            for constraint in model.constraints
        ],
    )


def _evaluate_constraint(
    constraint: Constraint,
    values_by_id: dict[str, float],
) -> ConstraintResult:
    activity = fsum(
        term.coefficient * values_by_id[term.variable_id]
        for term in constraint.terms
    )

    if constraint.operator == ConstraintOperator.less_than_or_equal:
        slack = constraint.rhs - activity
    elif constraint.operator == ConstraintOperator.greater_than_or_equal:
        slack = activity - constraint.rhs
    else:
        slack = 0.0

    tolerance = RELATIVE_TOLERANCE * max(
        1.0,
        abs(constraint.rhs),
        abs(activity),
    )
    if abs(slack) <= tolerance:
        slack = 0.0

    return ConstraintResult(
        constraint_id=constraint.id,
        activity=_normalize_zero(activity),
        rhs=constraint.rhs,
        slack=_normalize_zero(slack),
        active=abs(activity - constraint.rhs) <= tolerance,
    )


def _require_ok(status: highspy.HighsStatus, operation: str) -> None:
    if status != highspy.HighsStatus.kOk:
        raise RuntimeError(f"HiGHS failed to {operation} ({status}).")


def _normalize_zero(value: float) -> float:
    return 0.0 if value == 0.0 else value
