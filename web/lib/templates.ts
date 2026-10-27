import productMixModel from "../../templates/product-mix/model.json";
import productMixScenario from "../../templates/product-mix/scenario.json";
import type { OptimizationModel } from "./model";
import type { ScenarioDefinition } from "./scenario";

/**
 * A starting point: an ordinary OptimizationModel plus its semantic scenario.
 * The model stays fully editable after loading; the scenario only describes it.
 */
export interface Template {
  model: OptimizationModel;
  scenario: ScenarioDefinition;
}

// The JSON files are validated by the solver contract and by the tests in
// lib/scenario.test.ts. The casts only narrow string literals to the unions.
export const TEMPLATES: Template[] = [
  {
    model: productMixModel as unknown as OptimizationModel,
    scenario: productMixScenario as unknown as ScenarioDefinition,
  },
];
