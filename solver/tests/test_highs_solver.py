import highspy
import pytest

from optimization_sandbox.highs_solver import map_model_status, solve_model
from optimization_sandbox.schema import OptimizationModel, SolveStatus


def test_product_mix_has_expected_optimal_solution(product_mix_model):
    result = solve_model(product_mix_model)

    assert result.status is SolveStatus.optimal
    assert result.objective_value == pytest.approx(2200)
    assert result.message is None

    values = {item.variable_id: item.value for item in result.variable_values}
    assert list(values) == ["x1", "x2"]
    assert values["x1"] == pytest.approx(40)
    assert values["x2"] == pytest.approx(20)

    constraints = {item.constraint_id: item for item in result.constraints}
    assert list(constraints) == ["machine", "labor", "packaging"]

    machine = constraints["machine"]
    assert machine.activity == pytest.approx(100)
    assert machine.rhs == 100
    assert machine.slack == pytest.approx(0)
    assert machine.active is True

    labor = constraints["labor"]
    assert labor.activity == pytest.approx(80)
    assert labor.rhs == 80
    assert labor.slack == pytest.approx(0)
    assert labor.active is True

    packaging = constraints["packaging"]
    assert packaging.activity == pytest.approx(60)
    assert packaging.rhs == 100
    assert packaging.slack == pytest.approx(40)
    assert packaging.active is False


def test_minimize_and_greater_than_or_equal():
    model = OptimizationModel.model_validate(
        {
            "variables": [
                {
                    "id": "x",
                    "name": "x",
                    "type": "continuous",
                    "lowerBound": 0,
                    "upperBound": None,
                }
            ],
            "objective": {
                "sense": "minimize",
                "terms": [{"variableId": "x", "coefficient": 1}],
            },
            "constraints": [
                {
                    "id": "minimum",
                    "name": "Minimum",
                    "terms": [{"variableId": "x", "coefficient": 1}],
                    "operator": ">=",
                    "rhs": 10,
                }
            ],
        }
    )

    result = solve_model(model)

    assert result.status is SolveStatus.optimal
    assert result.objective_value == pytest.approx(10)
    assert result.variable_values[0].value == pytest.approx(10)
    assert result.constraints[0].slack == pytest.approx(0)
    assert result.constraints[0].active is True


def test_equality_constraint():
    model = OptimizationModel.model_validate(
        {
            "variables": [
                {
                    "id": "x",
                    "name": "x",
                    "type": "continuous",
                    "lowerBound": 0,
                    "upperBound": None,
                }
            ],
            "objective": {
                "sense": "maximize",
                "terms": [{"variableId": "x", "coefficient": 1}],
            },
            "constraints": [
                {
                    "id": "fixed",
                    "name": "Fixed value",
                    "terms": [{"variableId": "x", "coefficient": 1}],
                    "operator": "=",
                    "rhs": 5,
                }
            ],
        }
    )

    result = solve_model(model)

    assert result.status is SolveStatus.optimal
    assert result.objective_value == pytest.approx(5)
    assert result.constraints[0].activity == pytest.approx(5)
    assert result.constraints[0].slack == 0
    assert result.constraints[0].active is True


def test_infeasible_model_returns_no_values():
    model = OptimizationModel.model_validate(
        {
            "variables": [
                {
                    "id": "x",
                    "name": "x",
                    "type": "continuous",
                    "lowerBound": 0,
                    "upperBound": None,
                }
            ],
            "objective": {
                "sense": "maximize",
                "terms": [{"variableId": "x", "coefficient": 1}],
            },
            "constraints": [
                {
                    "id": "at-least-two",
                    "name": "At least two",
                    "terms": [{"variableId": "x", "coefficient": 1}],
                    "operator": ">=",
                    "rhs": 2,
                },
                {
                    "id": "at-most-one",
                    "name": "At most one",
                    "terms": [{"variableId": "x", "coefficient": 1}],
                    "operator": "<=",
                    "rhs": 1,
                },
            ],
        }
    )

    result = solve_model(model)

    assert result.status is SolveStatus.infeasible
    assert result.objective_value is None
    assert result.variable_values == []
    assert result.constraints == []


def test_unbounded_model_returns_no_values():
    model = OptimizationModel.model_validate(
        {
            "variables": [
                {
                    "id": "x",
                    "name": "x",
                    "type": "continuous",
                    "lowerBound": 0,
                    "upperBound": None,
                }
            ],
            "objective": {
                "sense": "maximize",
                "terms": [{"variableId": "x", "coefficient": 1}],
            },
            "constraints": [],
        }
    )

    result = solve_model(model)

    assert result.status is SolveStatus.unbounded
    assert result.objective_value is None
    assert result.variable_values == []
    assert result.constraints == []


def test_variable_bounds_are_applied():
    model = OptimizationModel.model_validate(
        {
            "variables": [
                {
                    "id": "x",
                    "name": "x",
                    "type": "continuous",
                    "lowerBound": 2,
                    "upperBound": 7,
                }
            ],
            "objective": {
                "sense": "maximize",
                "terms": [{"variableId": "x", "coefficient": 1}],
            },
            "constraints": [],
        }
    )

    result = solve_model(model)

    assert result.status is SolveStatus.optimal
    assert result.objective_value == pytest.approx(7)
    assert result.variable_values[0].value == pytest.approx(7)
    assert result.constraints == []


def test_three_variable_model():
    """A model built by the M2B editor: three variables, two constraints."""
    model = OptimizationModel.model_validate(
        {
            "variables": [
                {
                    "id": "x1",
                    "name": "x₁",
                    "type": "continuous",
                    "lowerBound": 0,
                    "upperBound": None,
                },
                {
                    "id": "x2",
                    "name": "x₂",
                    "type": "continuous",
                    "lowerBound": 0,
                    "upperBound": None,
                },
                {
                    "id": "x3",
                    "name": "x₃",
                    "type": "continuous",
                    "lowerBound": 0,
                    "upperBound": None,
                },
            ],
            "objective": {
                "sense": "maximize",
                "terms": [
                    {"variableId": "x1", "coefficient": 5},
                    {"variableId": "x2", "coefficient": 8},
                    {"variableId": "x3", "coefficient": 2},
                ],
            },
            "constraints": [
                {
                    "id": "machine",
                    "name": "Capacidad de máquina",
                    "terms": [
                        {"variableId": "x1", "coefficient": 2},
                        {"variableId": "x2", "coefficient": 1},
                    ],
                    "operator": "<=",
                    "rhs": 100,
                },
                {
                    "id": "labor",
                    "name": "Mano de obra",
                    "terms": [
                        {"variableId": "x1", "coefficient": 1},
                        {"variableId": "x3", "coefficient": 3},
                    ],
                    "operator": "<=",
                    "rhs": 80,
                },
            ],
        }
    )

    result = solve_model(model)

    assert result.status is SolveStatus.optimal
    assert result.objective_value == pytest.approx(2560 / 3)

    values = {item.variable_id: item.value for item in result.variable_values}
    assert list(values) == ["x1", "x2", "x3"]
    assert values["x1"] == pytest.approx(0)
    assert values["x2"] == pytest.approx(100)
    assert values["x3"] == pytest.approx(80 / 3)

    constraints = {item.constraint_id: item for item in result.constraints}
    assert constraints["machine"].slack == pytest.approx(0)
    assert constraints["machine"].active is True
    assert constraints["labor"].slack == pytest.approx(0)
    assert constraints["labor"].active is True


def test_ambiguous_highs_status_maps_to_error():
    assert map_model_status(highspy.HighsModelStatus.kOptimal) is SolveStatus.optimal
    assert map_model_status(highspy.HighsModelStatus.kInfeasible) is SolveStatus.infeasible
    assert map_model_status(highspy.HighsModelStatus.kUnbounded) is SolveStatus.unbounded
    assert (
        map_model_status(highspy.HighsModelStatus.kUnboundedOrInfeasible)
        is SolveStatus.error
    )
    assert map_model_status(highspy.HighsModelStatus.kTimeLimit) is SolveStatus.error


def test_unexpected_solver_failure_returns_error(monkeypatch, product_mix_model):
    def fail(_model):
        raise RuntimeError("boom")

    monkeypatch.setattr(
        "optimization_sandbox.highs_solver._solve_with_highs",
        fail,
    )

    result = solve_model(product_mix_model)

    assert result.status is SolveStatus.error
    assert result.objective_value is None
    assert result.variable_values == []
    assert result.constraints == []
    assert result.message is not None
