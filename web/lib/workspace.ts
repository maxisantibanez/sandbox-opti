import { createBlankModel } from "./blank-model";
import type { OptimizationModel } from "./model";
import { categoryLabel, type ScenarioDefinition } from "./scenario";
import type { Template } from "./templates";

/**
 * The model being edited plus, optionally, the semantics of the template it came
 * from. Exactly one OptimizationModel lives in `model`; the scenario only
 * references it by stable ids and is never sent to the solver.
 */
export interface Workspace {
  title: string;
  subtitle: string;
  model: OptimizationModel;
  scenario: ScenarioDefinition | null;
  /** The model as it was when the workspace was opened. Never edited. */
  origin: OptimizationModel;
}

export function blankWorkspace(): Workspace {
  return {
    title: "Modelo en blanco",
    subtitle: "Sin semántica · LP continuo",
    model: createBlankModel(),
    scenario: null,
    origin: createBlankModel(),
  };
}

export function templateWorkspace(template: Template): Workspace {
  const { metadata } = template.scenario;

  return {
    title: metadata.name,
    subtitle: `${categoryLabel(metadata.category)} · LP continuo`,
    model: structuredClone(template.model),
    scenario: template.scenario,
    origin: structuredClone(template.model),
  };
}

/**
 * True when the model differs from the one the workspace was opened with.
 * Edits never mutate the origin, and reverting every edit makes the value equal
 * again. Solver results do not count: only the model is user work.
 */
export function hasUnsavedChanges(workspace: Workspace): boolean {
  return JSON.stringify(workspace.model) !== JSON.stringify(workspace.origin);
}
