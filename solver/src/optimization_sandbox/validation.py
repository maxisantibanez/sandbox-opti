"""Cross-field validation for the canonical optimization model."""

from dataclasses import dataclass

from .schema import OptimizationModel, Term


@dataclass(frozen=True)
class ValidationIssue:
    path: str
    message: str


def validate_model(model: OptimizationModel) -> list[ValidationIssue]:
    """Return every contract violation found in ``model``.

    Shape validation is handled by Pydantic. These are the relational rules that
    cannot be expressed per field.
    """

    issues: list[ValidationIssue] = []

    seen_variable_ids: set[str] = set()
    for index, variable in enumerate(model.variables):
        path = f"variables[{index}]"

        if not variable.id.strip():
            issues.append(ValidationIssue(f"{path}.id", "Variable id must not be blank."))
        elif variable.id in seen_variable_ids:
            issues.append(
                ValidationIssue(
                    f"{path}.id",
                    f"Duplicate variable id '{variable.id}'.",
                )
            )
        seen_variable_ids.add(variable.id)

        if not variable.name.strip():
            issues.append(ValidationIssue(f"{path}.name", "Variable name must not be blank."))

        if (
            variable.lower_bound is not None
            and variable.upper_bound is not None
            and variable.lower_bound > variable.upper_bound
        ):
            issues.append(
                ValidationIssue(
                    f"{path}.lowerBound",
                    "lowerBound must be less than or equal to upperBound.",
                )
            )

    known_variable_ids = seen_variable_ids

    issues.extend(
        _validate_terms(
            model.objective.terms,
            "objective.terms",
            known_variable_ids,
        )
    )

    seen_constraint_ids: set[str] = set()
    for index, constraint in enumerate(model.constraints):
        path = f"constraints[{index}]"

        if not constraint.id.strip():
            issues.append(ValidationIssue(f"{path}.id", "Constraint id must not be blank."))
        elif constraint.id in seen_constraint_ids:
            issues.append(
                ValidationIssue(
                    f"{path}.id",
                    f"Duplicate constraint id '{constraint.id}'.",
                )
            )
        seen_constraint_ids.add(constraint.id)

        if not constraint.name.strip():
            issues.append(ValidationIssue(f"{path}.name", "Constraint name must not be blank."))

        issues.extend(
            _validate_terms(
                constraint.terms,
                f"{path}.terms",
                known_variable_ids,
            )
        )

    return issues


def _validate_terms(
    terms: list[Term],
    path: str,
    known_variable_ids: set[str],
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    seen_variable_ids: set[str] = set()

    for index, term in enumerate(terms):
        term_path = f"{path}[{index}].variableId"

        if not term.variable_id.strip():
            issues.append(ValidationIssue(term_path, "Variable id must not be blank."))
        elif term.variable_id not in known_variable_ids:
            issues.append(
                ValidationIssue(
                    term_path,
                    f"Unknown variable '{term.variable_id}'.",
                )
            )

        if term.variable_id in seen_variable_ids:
            issues.append(
                ValidationIssue(
                    term_path,
                    f"Variable '{term.variable_id}' appears more than once in the same expression.",
                )
            )
        seen_variable_ids.add(term.variable_id)

    return issues
