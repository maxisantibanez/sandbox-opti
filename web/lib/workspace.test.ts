import { describe, expect, it } from "vitest";

import { setVariableName, addVariable } from "./model-editing";
import {
  blankWorkspace,
  hasUnsavedChanges,
  templateWorkspace,
} from "./workspace";
import { TEMPLATES } from "./templates";

const productMixTemplate = TEMPLATES[0];

describe("unsaved changes", () => {
  it("a freshly opened template or blank model has no unsaved changes", () => {
    expect(hasUnsavedChanges(templateWorkspace(productMixTemplate))).toBe(false);
    expect(hasUnsavedChanges(blankWorkspace())).toBe(false);
  });

  it("an edit makes the workspace modified", () => {
    const workspace = templateWorkspace(productMixTemplate);

    const edited = {
      ...workspace,
      model: setVariableName(workspace.model, "x1", "Mesas"),
    };

    expect(hasUnsavedChanges(edited)).toBe(true);
  });

  it("reverting every edit makes the workspace unmodified again", () => {
    const workspace = templateWorkspace(productMixTemplate);
    const renamed = {
      ...workspace,
      model: setVariableName(workspace.model, "x1", "Mesas"),
    };
    const reverted = {
      ...renamed,
      model: setVariableName(renamed.model, "x1", "Producto A"),
    };

    expect(hasUnsavedChanges(reverted)).toBe(false);
  });

  it("structural edits count as unsaved changes", () => {
    const workspace = blankWorkspace();

    const added = { ...workspace, model: addVariable(workspace.model) };

    expect(hasUnsavedChanges(added)).toBe(true);
  });

  it("never mutates the origin of the workspace", () => {
    const workspace = templateWorkspace(productMixTemplate);
    const origin = structuredClone(workspace.origin);

    setVariableName(workspace.model, "x1", "Mesas");

    expect(workspace.origin).toEqual(origin);
    expect(productMixTemplate.model.variables[0].name).toBe("Producto A");
  });
});
