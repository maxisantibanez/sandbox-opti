"use client";

import { useRef, useState } from "react";

import { ModelEditor } from "@/components/model-editor";
import { ModelStart } from "@/components/model-start";
import { GeometricView } from "@/components/geometric-view";
import { ResultsPanel } from "@/components/results-panel";
import { scenarioViewFor } from "@/components/scenario-views";
import {
  VisualizationPanel,
  type VisualizationTab,
} from "@/components/visualization-panel";
import { NO_HIGHLIGHT, type Highlight } from "@/lib/highlight";
import type { OptimizationModel, OptimizationResult } from "@/lib/model";
import { pruneScenario } from "@/lib/scenario";
import {
  solveModel,
  SolveRequestError,
  type SolveIssue,
} from "@/lib/solve";
import {
  blankWorkspace,
  hasUnsavedChanges,
  templateWorkspace,
  type Workspace,
} from "@/lib/workspace";

interface RequestError {
  message: string;
  issues: SolveIssue[];
}

type SolveOutcome =
  | {
      kind: "result";
      model: OptimizationModel;
      result: OptimizationResult;
    }
  | {
      kind: "error";
      model: OptimizationModel;
      error: RequestError;
    };

type ViewId = "geometry" | "scenario";

export function Sandbox() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isChoosing, setIsChoosing] = useState(false);
  // A chosen workspace waiting for confirmation because the current one has unsaved changes.
  const [pending, setPending] = useState<Workspace | null>(null);
  const [outcome, setOutcome] = useState<SolveOutcome | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [highlight, setHighlight] = useState<Highlight>(NO_HIGHLIGHT);
  // The view chosen in the Visualización panel, remembered for the session.
  // Geometry is the default because it exists for every two-variable model.
  const [preferredView, setPreferredView] = useState<ViewId>("geometry");
  // Identifies the opened workspace, so views of a replaced model remount.
  const [workspaceKey, setWorkspaceKey] = useState(0);
  // Bumped whenever a different model replaces the workspace, so a solver
  // response that belongs to the previous model is discarded.
  const sessionRef = useRef(0);

  const result = outcome?.kind === "result" ? outcome.result : null;
  const error = outcome?.kind === "error" ? outcome.error : null;

  function openWorkspace(next: Workspace) {
    sessionRef.current += 1;
    setWorkspace(next);
    setIsChoosing(false);
    setPending(null);
    setIsSolving(false);
    setOutcome(null);
    setHighlight(NO_HIGHLIGHT);
    setWorkspaceKey((key) => key + 1);
  }

  // Cancelling the chooser keeps the current workspace object untouched.
  function closeChooser() {
    setPending(null);
    setIsChoosing(false);
  }

  function requestWorkspace(next: Workspace) {
    if (workspace && hasUnsavedChanges(workspace)) {
      setPending(next);
      return;
    }
    openWorkspace(next);
  }

  function handleModelChange(next: OptimizationModel) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            model: next,
            scenario: pruneScenario(current.scenario, next),
          }
        : current,
    );
    // A failed attempt describes a model that no longer exists once it changes.
    setOutcome((current) => (current?.kind === "error" ? null : current));
  }

  async function handleSolve() {
    if (!workspace) {
      return;
    }

    const modelToSolve = workspace.model;
    const session = sessionRef.current;

    setIsSolving(true);
    setOutcome(null);

    try {
      const solved = await solveModel(modelToSolve);
      if (session !== sessionRef.current) {
        return;
      }
      setOutcome({ kind: "result", model: modelToSolve, result: solved });
    } catch (cause) {
      if (session !== sessionRef.current) {
        return;
      }
      const requestError: RequestError =
        cause instanceof SolveRequestError
          ? { message: cause.message, issues: cause.issues }
          : {
              message: "Ocurrió un error inesperado al resolver el modelo.",
              issues: [],
            };

      setOutcome({ kind: "error", model: modelToSolve, error: requestError });
    } finally {
      if (session === sessionRef.current) {
        setIsSolving(false);
      }
    }
  }

  if (workspace === null || isChoosing) {
    return (
      <ModelStart
        onBlank={() => requestWorkspace(blankWorkspace())}
        onTemplate={(template) => requestWorkspace(templateWorkspace(template))}
        onCancel={workspace ? closeChooser : undefined}
        replacement={
          pending
            ? { title: pending.title, onConfirm: () => openWorkspace(pending) }
            : null
        }
      />
    );
  }

  const { model, scenario } = workspace;
  const isStale = outcome?.kind === "result" && outcome.model !== model;
  const resultModel = outcome?.kind === "result" ? outcome.model : model;
  const ScenarioView = scenarioViewFor(scenario);
  const view: ViewId = ScenarioView ? preferredView : "geometry";
  const tabs: VisualizationTab<ViewId>[] = [
    { id: "geometry", label: "Geometría", meta: "Región factible · dos variables" },
    ...(ScenarioView && scenario
      ? [
          {
            id: "scenario" as const,
            label: "Escenario",
            meta: `${scenario.metadata.name} · sistema modelado`,
          },
        ]
      : []),
  ];
  const highlightConstraint = (constraintId: string | null) =>
    setHighlight({ constraintId, variableId: null });

  return (
    <>
      <div className="sandbox-workspace">
        <div className="model-workspace">
          <p className="scenario-tag">
            <span className="scenario-name">{workspace.title}</span>
            <span className="scenario-meta">{workspace.subtitle}</span>
          </p>
          <ModelEditor
            model={model}
            scenario={scenario}
            onChange={handleModelChange}
            highlight={highlight}
            onHighlight={setHighlight}
          />
          <div className="action-row">
            <button
              type="button"
              className="solve-button"
              onClick={handleSolve}
              disabled={isSolving}
            >
              {isSolving ? "Resolviendo…" : "Resolver modelo"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setIsChoosing(true)}
            >
              Nuevo modelo
            </button>
          </div>
        </div>
        <VisualizationPanel
          key={workspaceKey}
          tabs={tabs}
          selected={view}
          onSelect={setPreferredView}
        >
          {view === "scenario" && ScenarioView && scenario ? (
            <ScenarioView
              model={model}
              scenario={scenario}
              solved={outcome?.kind === "result" ? outcome : null}
              isSolving={isSolving}
              highlight={highlight}
              onHighlight={setHighlight}
              onResolve={handleSolve}
            />
          ) : (
            <GeometricView
              model={model}
              result={isStale ? null : result}
              isStale={isStale}
              highlightedConstraintId={highlight.constraintId}
              onHighlight={highlightConstraint}
            />
          )}
        </VisualizationPanel>
      </div>

      <div aria-live="polite" aria-busy={isSolving}>
        <ResultsPanel
          model={resultModel}
          result={result}
          error={error}
          isSolving={isSolving}
          isStale={isStale}
          onResolve={handleSolve}
        />
      </div>
    </>
  );
}
