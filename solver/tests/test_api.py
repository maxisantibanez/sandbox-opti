import pytest
from fastapi.testclient import TestClient

from optimization_sandbox.api import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_solve_product_mix(client, product_mix_model):
    payload = product_mix_model.model_dump(by_alias=True, mode="json")

    response = client.post("/solve", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "optimal"
    assert body["objectiveValue"] == pytest.approx(2200)
    assert body["variableValues"] == [
        {"variableId": "x1", "value": pytest.approx(40)},
        {"variableId": "x2", "value": pytest.approx(20)},
    ]
    assert body["message"] is None

    constraints = {item["constraintId"]: item for item in body["constraints"]}
    assert constraints["machine"] == {
        "constraintId": "machine",
        "activity": pytest.approx(100),
        "rhs": 100,
        "slack": pytest.approx(0),
        "active": True,
    }
    assert constraints["packaging"] == {
        "constraintId": "packaging",
        "activity": pytest.approx(60),
        "rhs": 100,
        "slack": pytest.approx(40),
        "active": False,
    }


def test_unknown_variable_returns_structured_422(client, product_mix_payload):
    product_mix_payload["objective"]["terms"][0]["variableId"] = "x9"

    response = client.post("/solve", json=product_mix_payload)

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "invalid_model"
    assert body["error"]["issues"] == [
        {
            "path": "objective.terms[0].variableId",
            "message": "Unknown variable 'x9'.",
        }
    ]


def test_missing_field_returns_structured_422(client, product_mix_payload):
    del product_mix_payload["variables"][0]["lowerBound"]

    response = client.post("/solve", json=product_mix_payload)

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "invalid_model"
    assert body["error"]["issues"][0]["path"] == "variables[0].lowerBound"


def test_empty_variable_list_returns_structured_422(client, product_mix_payload):
    product_mix_payload["variables"] = []

    response = client.post("/solve", json=product_mix_payload)

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["issues"][0]["path"] == "variables"


def test_scenario_metadata_is_rejected_by_the_solver_contract(
    client, product_mix_payload
):
    # Semantic scenario data lives in the frontend and must never reach /solve.
    product_mix_payload["scenario"] = {
        "metadata": {"id": "product-mix", "name": "Product Mix"},
        "variableBindings": [{"variableId": "x1", "role": "product"}],
    }

    response = client.post("/solve", json=product_mix_payload)

    assert response.status_code == 422
    assert response.json()["error"]["issues"][0]["path"] == "scenario"


def test_model_without_constraints_is_a_valid_lp(client):
    # The blank model in the frontend: Max x1 + x2 with no constraints.
    payload = {
        "variables": [
            {"id": "x1", "name": "x₁", "type": "continuous", "lowerBound": 0, "upperBound": None},
            {"id": "x2", "name": "x₂", "type": "continuous", "lowerBound": 0, "upperBound": None},
        ],
        "objective": {
            "sense": "maximize",
            "terms": [
                {"variableId": "x1", "coefficient": 1},
                {"variableId": "x2", "coefficient": 1},
            ],
        },
        "constraints": [],
    }

    response = client.post("/solve", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unbounded"
    assert body["constraints"] == []
