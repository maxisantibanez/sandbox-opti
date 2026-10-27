from optimization_sandbox.validation import validate_model


def test_product_mix_is_valid(product_mix_model):
    assert validate_model(product_mix_model) == []


def test_unknown_variable_in_objective_is_reported(product_mix_model):
    model = product_mix_model.model_copy(deep=True)
    model.objective.terms[0].variable_id = "x9"

    issues = validate_model(model)

    assert [(issue.path, issue.message) for issue in issues] == [
        (
            "objective.terms[0].variableId",
            "Unknown variable 'x9'.",
        )
    ]


def test_unknown_variable_in_constraint_is_reported(product_mix_model):
    model = product_mix_model.model_copy(deep=True)
    model.constraints[0].terms[1].variable_id = "x9"

    issues = validate_model(model)

    assert [issue.path for issue in issues] == ["constraints[0].terms[1].variableId"]


def test_duplicate_term_in_constraint_is_reported(product_mix_model):
    model = product_mix_model.model_copy(deep=True)
    model.constraints[0].terms[1].variable_id = "x1"

    issues = validate_model(model)

    assert [issue.path for issue in issues] == ["constraints[0].terms[1].variableId"]
    assert "more than once" in issues[0].message


def test_duplicate_variable_id_is_reported(product_mix_model):
    model = product_mix_model.model_copy(deep=True)
    model.variables[1].id = "x1"

    issues = validate_model(model)

    assert (
        "variables[1].id",
        "Duplicate variable id 'x1'.",
    ) in [(issue.path, issue.message) for issue in issues]


def test_duplicate_constraint_id_is_reported(product_mix_model):
    model = product_mix_model.model_copy(deep=True)
    model.constraints[2].id = "machine"

    issues = validate_model(model)

    assert [(issue.path, issue.message) for issue in issues] == [
        ("constraints[2].id", "Duplicate constraint id 'machine'.")
    ]


def test_inverted_bounds_are_reported(product_mix_model):
    model = product_mix_model.model_copy(deep=True)
    model.variables[0].lower_bound = 10
    model.variables[0].upper_bound = 5

    issues = validate_model(model)

    assert [issue.path for issue in issues] == ["variables[0].lowerBound"]
    assert "lowerBound" in issues[0].message


def test_blank_names_are_reported(product_mix_model):
    model = product_mix_model.model_copy(deep=True)
    model.variables[0].name = "   "
    model.constraints[0].name = ""

    issues = validate_model(model)

    assert [issue.path for issue in issues] == [
        "variables[0].name",
        "constraints[0].name",
    ]
