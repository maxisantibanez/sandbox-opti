// Tones for the Production Floor, derived from the page palette. A product
// keeps its tone everywhere it appears (its column and its share inside each
// resource vessel), so the colour carries meaning. Tones differ in lightness,
// so the scene still reads in greyscale.

export const PRODUCT_TONES = ["#315c4e", "#8aa79a", "#5e7d71", "#bccbc3"];

/** Use of a resource by variables that have no meaning in the scenario. */
export const UNREPRESENTED_TONE = "#cbc4b4";

export function productTone(index: number): string {
  return PRODUCT_TONES[index % PRODUCT_TONES.length];
}

export const SCENE_COLORS = {
  ink: "#211f1a",
  muted: "#6c665b",
  rule: "#d6d0c1",
  platform: "#ece7dc",
  plinth: "#e2dccd",
  channel: "#b3ab99",
  accent: "#315c4e",
} as const;
