"use client";

import { useState } from "react";

import { MathNumberInput } from "@/components/math-number-input";
import { MathTextInput } from "@/components/math-text-input";
import { formatNumber } from "@/lib/format";
import { NO_HIGHLIGHT, type Highlight } from "@/lib/highlight";
import {
  addConstraint,
  addConstraintTerm,
  addObjectiveTerm,
  addVariable,
  removeConstraint,
  removeConstraintTerm,
  removeObjectiveTerm,
  removeVariable,
  setConstraintCoefficient,
  setConstraintName,
  setConstraintOperator,
  setConstraintRhs,
  setObjectiveCoefficient,
  setObjectiveSense,
  setVariableName,
} from "@/lib/model-editing";
import {
  constraintRole,
  roleLabel,
  variableRole,
  type ScenarioDefinition,
} from "@/lib/scenario";
import type {
  Constraint,
  ConstraintOperator,
  ObjectiveSense,
  OptimizationModel,
  Term,
  Variable,
} from "@/lib/model";

interface ModelEditorProps {
  model: OptimizationModel;
  /** Semantics of the loaded template, or null for a blank model. */
  scenario: ScenarioDefinition | null;
  onChange: (model: OptimizationModel) => void;
  /** Constraint, variable or single term focused in any view. */
  highlight?: Highlight;
  onHighlight?: (highlight: Highlight) => void;
}

export function ModelEditor({ model, scenario, onChange, highlight = NO_HIGHLIGHT, onHighlight }: ModelEditorProps) {
  // A variable alone (a product) marks all its terms; with a constraint, only
  // the term of that constraint.
  const objectiveVariableId =
    highlight.constraintId === null ? highlight.variableId : null;

  // Presentation-only state: reports structural side effects of an edit, such
  // as constraints that disappear when a variable removal empties them.
  const [cascadeNotice, setCascadeNotice] = useState<string | null>(null);

  const variablesById = new Map(
    model.variables.map((variable) => [variable.id, variable]),
  );

  function apply(next: OptimizationModel) {
    setCascadeNotice(null);
    onChange(next);
  }

  function handleRemoveVariable(variableId: string) {
    const next = removeVariable(model, variableId);
    setCascadeNotice(
      formatCascadeNotice(model.constraints.length - next.constraints.length),
    );
    onChange(next);
  }

  function variableRemovalBlockReason(variableId: string): string | null {
    if (model.variables.length <= 1) {
      return "El modelo necesita al menos una variable.";
    }
    if (model.objective.terms.every((term) => term.variableId === variableId)) {
      return "La función objetivo debe conservar al menos un término.";
    }
    return null;
  }

  return (
    <section aria-labelledby="model-heading">
      <div className="section-heading">
        <span className="section-index">01</span>
        <h2 id="model-heading">Modelo</h2>
        <span className="section-meta">Editable · programación lineal</span>
      </div>

      <div className="objective math-line formula">
        <select
          className="math-select"
          aria-label="Sentido de la función objetivo"
          value={model.objective.sense}
          onChange={(event) =>
            apply(
              setObjectiveSense(
                model,
                event.target.value as ObjectiveSense,
              ),
            )
          }
        >
          <option value="maximize">Max</option>
          <option value="minimize">Min</option>
        </select>
        <span className="math-fixed">Z =</span>
        <EditableTerms
          terms={model.objective.terms}
          variablesById={variablesById}
          context="la función objetivo"
          canRemove={model.objective.terms.length > 1}
          highlightedVariableId={objectiveVariableId}
          onHighlightTerm={(variableId) =>
            onHighlight?.({ constraintId: null, variableId })
          }
          onCoefficientChange={(variableId, coefficient) =>
            apply(
              setObjectiveCoefficient(model, variableId, coefficient),
            )
          }
          onRemove={(variableId) =>
            apply(removeObjectiveTerm(model, variableId))
          }
        />
        <AddTermSelect
          variables={spareVariables(model.variables, model.objective.terms)}
          context="la función objetivo"
          onAdd={(variableId) => apply(addObjectiveTerm(model, variableId))}
        />
      </div>

      {model.constraints.length > 0 ? (
        <>
          <p className="subject-to">sujeto a</p>
          <ul className="constraint-list">
            {model.constraints.map((constraint) => (
              <ConstraintEditor
                key={constraint.id}
                model={model}
                constraint={constraint}
                variablesById={variablesById}
                scenario={scenario}
                onApply={apply}
                highlighted={constraint.id === highlight.constraintId}
                highlightedVariableId={
                  highlight.constraintId === null ||
                  highlight.constraintId === constraint.id
                    ? highlight.variableId
                    : null
                }
                onHighlight={onHighlight}
              />
            ))}
          </ul>
        </>
      ) : null}

      {cascadeNotice ? (
        <p className="cascade-notice" role="status">
          {cascadeNotice}
        </p>
      ) : null}

      <p className="bounds">
        <span className="bounds-label">Dominio</span>
        <span className="formula bounds-items">
          {model.variables.map((variable) => {
            const removalBlock = variableRemovalBlockReason(variable.id);

            return (
              <span
                className={
                  variable.id === objectiveVariableId
                    ? "bounds-item is-highlighted"
                    : "bounds-item"
                }
                key={variable.id}
              >
                {variable.lowerBound !== null &&
                variable.upperBound !== null ? (
                  <span className="bounds-constraint">
                    {formatNumber(variable.lowerBound)} ≤
                  </span>
                ) : null}
                <MathTextInput
                  value={variable.name}
                  label={`Nombre de la variable ${variable.name}`}
                  onChange={(name) =>
                    apply(setVariableName(model, variable.id, name))
                  }
                />
                {scenario ? (
                  <SemanticTag role={variableRole(scenario, variable.id)} />
                ) : null}
                <span className="bounds-constraint">
                  {variableBoundSuffix(variable)}
                </span>
                <button
                  type="button"
                  className="math-remove"
                  aria-label={`Eliminar variable ${variable.name}`}
                  title={removalBlock ?? undefined}
                  disabled={removalBlock !== null}
                  onClick={() => handleRemoveVariable(variable.id)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => apply(addVariable(model))}
        >
          + Agregar variable
        </button>
      </p>

      <p className="add-constraint-row">
        <button
          type="button"
          className="text-button"
          onClick={() => apply(addConstraint(model))}
        >
          + Agregar restricción
        </button>
      </p>
    </section>
  );
}

function ConstraintEditor({
  model,
  constraint,
  variablesById,
  scenario,
  onApply,
  highlighted,
  highlightedVariableId,
  onHighlight,
}: {
  model: OptimizationModel;
  constraint: Constraint;
  variablesById: Map<string, Variable>;
  scenario: ScenarioDefinition | null;
  onApply: (model: OptimizationModel) => void;
  highlighted: boolean;
  highlightedVariableId: string | null;
  onHighlight?: (highlight: Highlight) => void;
}) {
  const own = { constraintId: constraint.id, variableId: null };
  return (
    <li data-constraint-id={constraint.id} className={highlighted ? "is-highlighted" : undefined}
      onMouseEnter={() => onHighlight?.(own)} onMouseLeave={() => onHighlight?.(NO_HIGHLIGHT)}
      onFocusCapture={() => onHighlight?.(own)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHighlight?.(NO_HIGHLIGHT);
      }}>
      <MathTextInput
        value={constraint.name}
        className="constraint-name"
        label={`Nombre de la restricción ${constraint.name}`}
        onChange={(name) =>
          onApply(setConstraintName(model, constraint.id, name))
        }
      />
      {scenario ? (
        <SemanticTag role={constraintRole(scenario, constraint.id)} />
      ) : null}
      <div className="constraint-formula math-line formula">
        <EditableTerms
          terms={constraint.terms}
          variablesById={variablesById}
          context={constraint.name}
          canRemove={constraint.terms.length > 1}
          highlightedVariableId={highlightedVariableId}
          onHighlightTerm={(variableId) =>
            onHighlight?.({ constraintId: constraint.id, variableId })
          }
          onCoefficientChange={(variableId, coefficient) =>
            onApply(
              setConstraintCoefficient(
                model,
                constraint.id,
                variableId,
                coefficient,
              ),
            )
          }
          onRemove={(variableId) =>
            onApply(removeConstraintTerm(model, constraint.id, variableId))
          }
        />
        <AddTermSelect
          variables={spareVariables(model.variables, constraint.terms)}
          context={constraint.name}
          onAdd={(variableId) =>
            onApply(addConstraintTerm(model, constraint.id, variableId))
          }
        />
        <select
          className="math-select"
          aria-label={`Operador de ${constraint.name}`}
          value={constraint.operator}
          onChange={(event) =>
            onApply(
              setConstraintOperator(
                model,
                constraint.id,
                event.target.value as ConstraintOperator,
              ),
            )
          }
        >
          <option value="<=">≤</option>
          <option value=">=">≥</option>
          <option value="=">=</option>
        </select>
        <MathNumberInput
          value={constraint.rhs}
          label={`Lado derecho de ${constraint.name}`}
          onChange={(rhs) =>
            onApply(setConstraintRhs(model, constraint.id, rhs))
          }
        />
        <button
          type="button"
          className="math-remove"
          aria-label={`Eliminar restricción ${constraint.name}`}
          onClick={() => onApply(removeConstraint(model, constraint.id))}
        >
          ×
        </button>
      </div>
    </li>
  );
}

function EditableTerms({
  terms,
  variablesById,
  context,
  canRemove,
  highlightedVariableId,
  onHighlightTerm,
  onCoefficientChange,
  onRemove,
}: {
  terms: Term[];
  variablesById: Map<string, Variable>;
  context: string;
  canRemove: boolean;
  highlightedVariableId: string | null;
  /** Hovering a term focuses that term; leaving it returns to the expression. */
  onHighlightTerm: (variableId: string | null) => void;
  onCoefficientChange: (variableId: string, coefficient: number) => void;
  onRemove: (variableId: string) => void;
}) {
  return (
    <>
      {terms.map((term, index) => {
        const name =
          variablesById.get(term.variableId)?.name ?? term.variableId;

        return (
          <span
            className={
              term.variableId === highlightedVariableId
                ? "math-term is-highlighted"
                : "math-term"
            }
            data-variable-id={term.variableId}
            key={term.variableId}
            onMouseEnter={() => onHighlightTerm(term.variableId)}
            onMouseLeave={() => onHighlightTerm(null)}
          >
            {index > 0 ? <span className="math-operator">+</span> : null}
            <MathNumberInput
              value={term.coefficient}
              label={`Coeficiente de ${name} en ${context}`}
              onChange={(coefficient) =>
                onCoefficientChange(term.variableId, coefficient)
              }
            />
            <span className="math-variable">{name}</span>
            <button
              type="button"
              className="math-remove"
              aria-label={`Eliminar término de ${name} en ${context}`}
              disabled={!canRemove}
              onClick={() => onRemove(term.variableId)}
            >
              ×
            </button>
          </span>
        );
      })}
    </>
  );
}

/**
 * Inline selector that appends a term. It only offers the variables that do
 * not appear yet in the expression, and disappears once every variable is
 * present: the contract allows a variable at most once per term list.
 */
function AddTermSelect({
  variables,
  context,
  onAdd,
}: {
  variables: Variable[];
  context: string;
  onAdd: (variableId: string) => void;
}) {
  if (variables.length === 0) {
    return null;
  }

  return (
    <select
      className="math-select math-add-select"
      aria-label={`Agregar término a ${context}`}
      value=""
      onChange={(event) => {
        const variableId = event.target.value;
        if (variableId) {
          onAdd(variableId);
        }
      }}
    >
      <option value="" disabled>
        + término
      </option>
      {variables.map((variable) => (
        <option key={variable.id} value={variable.id}>
          {variable.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Read-only semantic state of one entity. A null role means the entity exists
 * in the math but has no binding: it stays valid, it just has no meaning yet.
 */
function SemanticTag({ role }: { role: string | null }) {
  return (
    <span className={role ? "semantic-tag" : "semantic-tag is-unbound"}>
      {role ? roleLabel(role) : "sin semántica"}
    </span>
  );
}

function variableBoundSuffix(variable: Variable): string {
  const { lowerBound, upperBound } = variable;

  if (lowerBound !== null && upperBound !== null) {
    return `≤ ${formatNumber(upperBound)}`;
  }
  if (lowerBound !== null) {
    return `≥ ${formatNumber(lowerBound)}`;
  }
  if (upperBound !== null) {
    return `≤ ${formatNumber(upperBound)}`;
  }
  return "libre";
}

function spareVariables(variables: Variable[], terms: Term[]): Variable[] {
  return variables.filter(
    (variable) => !terms.some((term) => term.variableId === variable.id),
  );
}

function formatCascadeNotice(removedCount: number): string | null {
  if (removedCount === 0) {
    return null;
  }
  if (removedCount === 1) {
    return "Se eliminó 1 restricción que quedó vacía.";
  }
  return `Se eliminaron ${removedCount} restricciones que quedaron vacías.`;
}
