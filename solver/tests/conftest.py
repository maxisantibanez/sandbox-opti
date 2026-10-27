import json
from pathlib import Path

import pytest

from optimization_sandbox.schema import OptimizationModel

REPO_ROOT = Path(__file__).resolve().parents[2]
PRODUCT_MIX_PATH = REPO_ROOT / "templates" / "product-mix" / "model.json"


@pytest.fixture
def product_mix_payload() -> dict:
    return json.loads(PRODUCT_MIX_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def product_mix_model(product_mix_payload: dict) -> OptimizationModel:
    return OptimizationModel.model_validate(product_mix_payload)
