import type { ComponentType } from "react";

import { ProductMixScenarioView } from "@/components/scenario/product-mix-view";
import type { Highlight } from "@/lib/highlight";
import type { OptimizationModel } from "@/lib/model";
import type { SolvedSnapshot } from "@/lib/product-mix-scene";
import type { ScenarioDefinition } from "@/lib/scenario";

export interface ScenarioViewProps {
  model: OptimizationModel;
  scenario: ScenarioDefinition;
  /** Last solver result with the model it solved; the view checks staleness. */
  solved: SolvedSnapshot | null;
  isSolving: boolean;
  highlight: Highlight;
  onHighlight: (highlight: Highlight) => void;
  onResolve: () => void;
}

// Scenario renderer registry: scenario id → view. Adding a scenario view means
// adding one entry here. Nothing else in the application compares scenario ids.
const SCENARIO_VIEWS: Record<string, ComponentType<ScenarioViewProps>> = {
  "product-mix": ProductMixScenarioView,
};

/** The view registered for this scenario, or null when there is none. */
export function scenarioViewFor(
  scenario: ScenarioDefinition | null,
): ComponentType<ScenarioViewProps> | null {
  return scenario ? (SCENARIO_VIEWS[scenario.metadata.id] ?? null) : null;
}
