/**
 * Presentation-only focus shared by the editor and the views. A constraint
 * alone is a resource or boundary; a variable alone is a product; both
 * together are one term of that constraint. It never touches the model.
 */
export interface Highlight {
  constraintId: string | null;
  variableId: string | null;
}

export const NO_HIGHLIGHT: Highlight = { constraintId: null, variableId: null };
