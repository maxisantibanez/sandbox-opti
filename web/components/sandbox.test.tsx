import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "@/components/sandbox";
import type { OptimizationResult } from "@/lib/model";
import { createBlankModel } from "@/lib/blank-model";
import { solveModel } from "@/lib/solve";
import { TEMPLATES } from "@/lib/templates";

vi.mock("@/lib/solve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/solve")>();
  return { ...actual, solveModel: vi.fn() };
});

const solveMock = vi.mocked(solveModel);
const productMixModel = TEMPLATES[0].model;

const optimalResult: OptimizationResult = {
  status: "optimal",
  objectiveValue: 2200,
  variableValues: [
    { variableId: "x1", value: 40 },
    { variableId: "x2", value: 20 },
  ],
  constraints: [
    {
      constraintId: "machine",
      activity: 100,
      rhs: 100,
      slack: 0,
      active: true,
    },
    {
      constraintId: "labor",
      activity: 80,
      rhs: 80,
      slack: 0,
      active: true,
    },
    {
      constraintId: "packaging",
      activity: 60,
      rhs: 100,
      slack: 40,
      active: false,
    },
  ],
  message: null,
};

beforeEach(() => {
  solveMock.mockReset();
  solveMock.mockResolvedValue(optimalResult);
});

type User = ReturnType<typeof userEvent.setup>;

async function renderProductMix(user: User) {
  render(<Sandbox />);
  await user.click(screen.getByRole("button", { name: /^Product Mix/ }));
}

function objectiveCoefficient(name: string) {
  return screen.getByLabelText(
    `Coeficiente de ${name} en la función objetivo`,
  );
}

async function solve(user: User) {
  await user.click(screen.getByRole("button", { name: "Resolver modelo" }));
  await screen.findByText("Solución óptima");
}

/** The row of the domain line that contains the given variable name. */
function variableRow(name: string) {
  return screen.getByLabelText(`Nombre de la variable ${name}`).closest(
    ".bounds-item",
  ) as HTMLElement;
}

describe("interactive model editor", () => {
  it("starts from the canonical product-mix model", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    expect(objectiveCoefficient("Producto A")).toHaveValue("40");
    expect(objectiveCoefficient("Producto B")).toHaveValue("30");
    expect(
      screen.getByLabelText("Coeficiente de Producto A en Capacidad de máquina"),
    ).toHaveValue("2");
    expect(
      screen.getByLabelText("Coeficiente de Producto B en Mano de obra"),
    ).toHaveValue("2");
    expect(screen.getByLabelText("Lado derecho de Empaque")).toHaveValue(
      "100",
    );
    expect(
      screen.getByLabelText("Sentido de la función objetivo"),
    ).toHaveValue("maximize");
    expect(
      screen.getByLabelText("Operador de Capacidad de máquina"),
    ).toHaveValue("<=");
  });

  it("sends the edited objective coefficients and sense", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    const coefficient = objectiveCoefficient("Producto A");
    await user.clear(coefficient);
    await user.type(coefficient, "50");
    await user.selectOptions(
      screen.getByLabelText("Sentido de la función objetivo"),
      "minimize",
    );

    await solve(user);

    const sent = solveMock.mock.calls[0][0];
    expect(sent.objective.sense).toBe("minimize");
    expect(sent.objective.terms).toEqual([
      { variableId: "x1", coefficient: 50 },
      { variableId: "x2", coefficient: 30 },
    ]);
  });

  it("edits the targeted constraint without touching the others", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.selectOptions(
      screen.getByLabelText("Operador de Mano de obra"),
      ">=",
    );

    const rhs = screen.getByLabelText("Lado derecho de Mano de obra");
    await user.clear(rhs);
    await user.type(rhs, "120");

    const packagingCoefficient = screen.getByLabelText(
      "Coeficiente de Producto B en Empaque",
    );
    await user.clear(packagingCoefficient);
    await user.type(packagingCoefficient, "3");

    await solve(user);

    const sent = solveMock.mock.calls[0][0];
    expect(sent.constraints[0].operator).toBe("<=");
    expect(sent.constraints[0].rhs).toBe(100);
    expect(sent.constraints[1].operator).toBe(">=");
    expect(sent.constraints[1].rhs).toBe(120);
    expect(sent.constraints[2].operator).toBe("<=");
    expect(sent.constraints[2].terms[1].coefficient).toBe(3);
  });

  it("solves the model as it is at the moment of solving", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    const coefficient = objectiveCoefficient("Producto B");
    await user.clear(coefficient);
    await user.type(coefficient, "45");
    await solve(user);

    await user.clear(coefficient);
    await user.type(coefficient, "60");
    await user.click(
      screen.getByRole("button", { name: "Resolver nuevamente" }),
    );

    await waitFor(() => expect(solveMock).toHaveBeenCalledTimes(2));
    expect(solveMock.mock.calls[0][0].objective.terms[1].coefficient).toBe(45);
    expect(solveMock.mock.calls[1][0].objective.terms[1].coefficient).toBe(60);
    await screen.findByText("Solución óptima");
  });

  it("marks the previous solution as stale after an edit", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await solve(user);
    expect(
      screen.queryByText("El modelo cambió desde la última resolución."),
    ).not.toBeInTheDocument();

    const coefficient = objectiveCoefficient("Producto A");
    await user.clear(coefficient);
    await user.type(coefficient, "50");

    expect(
      screen.getByText("El modelo cambió desde la última resolución."),
    ).toBeInTheDocument();
    expect(screen.getByText("Solución anterior")).toBeInTheDocument();
    expect(screen.getByText("Valor anterior")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resolver nuevamente" }),
    ).toBeInTheDocument();
  });

  it("does not commit an empty field as zero", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    const coefficient = objectiveCoefficient("Producto A");
    await user.click(coefficient);
    await user.clear(coefficient);
    expect(coefficient).toHaveValue("");

    await solve(user);

    expect(solveMock.mock.calls[0][0].objective.terms[0].coefficient).toBe(40);
    expect(coefficient).toHaveValue("40");
  });

  it("accepts negative and decimal coefficients", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    const coefficient = objectiveCoefficient("Producto B");
    await user.clear(coefficient);
    await user.type(coefficient, "-2,5");

    await solve(user);

    expect(solveMock.mock.calls[0][0].objective.terms[1].coefficient).toBe(
      -2.5,
    );
    expect(coefficient).toHaveValue("-2,5");
  });
});

describe("model builder", () => {
  it("adds a variable and appends it to the objective as a term", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    // The objective already uses every variable: nothing to offer yet.
    expect(
      screen.queryByLabelText("Agregar término a la función objetivo"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Agregar variable" }));

    expect(screen.getByLabelText("Nombre de la variable x₃")).toHaveValue(
      "x₃",
    );

    await user.selectOptions(
      screen.getByLabelText("Agregar término a la función objetivo"),
      "x3",
    );

    const term = screen.getByLabelText("Coeficiente de x₃ en la función objetivo");
    expect(term).toHaveValue("1");
    await user.clear(term);
    await user.type(term, "5");

    await solve(user);

    const sent = solveMock.mock.calls[0][0];
    expect(sent.variables[2]).toEqual({
      id: "x3",
      name: "x₃",
      type: "continuous",
      lowerBound: 0,
      upperBound: null,
    });
    expect(sent.objective.terms).toEqual([
      { variableId: "x1", coefficient: 40 },
      { variableId: "x2", coefficient: 30 },
      { variableId: "x3", coefficient: 5 },
    ]);
  });

  it("renames variables and constraints without breaking references", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    const name = screen.getByLabelText("Nombre de la variable Producto A");
    await user.clear(name);
    await user.type(name, "Mesas");

    // An emptied label field never commits a blank name.
    const constraintName = screen.getByLabelText(
      "Nombre de la restricción Empaque",
    );
    await user.clear(constraintName);

    await solve(user);

    const sent = solveMock.mock.calls[0][0];
    expect(sent.variables[0]).toMatchObject({ id: "x1", name: "Mesas" });
    expect(sent.objective.terms[0]).toEqual({
      variableId: "x1",
      coefficient: 40,
    });
    expect(sent.constraints[2].name).toBe("Empaque");

    expect(constraintName).toHaveValue("Empaque");
    await user.clear(constraintName);
    await user.type(constraintName, "Embalaje");
    await solve(user);

    const renamed = solveMock.mock.calls[1][0];
    expect(renamed.constraints[2]).toEqual({
      ...sent.constraints[2],
      name: "Embalaje",
    });
    expect(renamed.constraints.slice(0, 2)).toEqual(sent.constraints.slice(0, 2));
    expect(renamed.variables).toEqual(sent.variables);
    expect(renamed.objective).toEqual(sent.objective);
  });

  it("appends a seeded constraint and edits it inline", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(
      screen.getByRole("button", { name: "+ Agregar restricción" }),
    );

    expect(
      screen.getByLabelText("Nombre de la restricción Restricción 4"),
    ).toHaveValue("Restricción 4");
    expect(
      screen.getByLabelText("Coeficiente de Producto A en Restricción 4"),
    ).toHaveValue("1");
    expect(screen.getByLabelText("Operador de Restricción 4")).toHaveValue(
      "<=",
    );
    const rhs = screen.getByLabelText("Lado derecho de Restricción 4");
    expect(rhs).toHaveValue("0");

    await user.clear(rhs);
    await user.type(rhs, "80");

    await solve(user);

    const sent = solveMock.mock.calls[0][0];
    expect(sent.constraints[3]).toEqual({
      id: "constraint1",
      name: "Restricción 4",
      terms: [{ variableId: "x1", coefficient: 1 }],
      operator: "<=",
      rhs: 80,
    });
  });

  it("adds a term to a constraint through the inline selector", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(screen.getByRole("button", { name: "+ Agregar variable" }));
    await user.selectOptions(
      screen.getByLabelText("Agregar término a Empaque"),
      "x3",
    );

    const term = screen.getByLabelText("Coeficiente de x₃ en Empaque");
    await user.clear(term);
    await user.type(term, "3");

    await solve(user);

    const sent = solveMock.mock.calls[0][0];
    expect(sent.constraints[2].terms).toEqual([
      { variableId: "x1", coefficient: 1 },
      { variableId: "x2", coefficient: 1 },
      { variableId: "x3", coefficient: 3 },
    ]);
  });

  it("removes a constraint from the expression", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(
      screen.getByRole("button", { name: "Eliminar restricción Empaque" }),
    );

    expect(
      screen.queryByLabelText("Lado derecho de Empaque"),
    ).not.toBeInTheDocument();

    await solve(user);

    expect(solveMock.mock.calls[0][0].constraints).toHaveLength(2);
  });

  it("removes a term and guards the last term of each expression", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(
      screen.getByRole("button", { name: "Eliminar término de Producto B en Empaque" }),
    );
    expect(
      screen.queryByLabelText("Coeficiente de Producto B en Empaque"),
    ).not.toBeInTheDocument();

    const packagingLast = screen.getByRole("button", {
      name: "Eliminar término de Producto A en Empaque",
    });
    expect(packagingLast).toBeDisabled();

    await user.click(
      screen.getByRole("button", {
        name: "Eliminar término de Producto A en la función objetivo",
      }),
    );
    expect(
      screen.queryByLabelText("Coeficiente de Producto A en la función objetivo"),
    ).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", {
        name: "Eliminar término de Producto B en la función objetivo",
      }),
    ).toBeDisabled();

    await solve(user);

    const sent = solveMock.mock.calls[0][0];
    expect(sent.objective.terms).toEqual([
      { variableId: "x2", coefficient: 30 },
    ]);
    expect(sent.constraints[2].terms).toEqual([
      { variableId: "x1", coefficient: 1 },
    ]);
  });

  it("removes a variable and reports constraints emptied by the cascade", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(
      screen.getByRole("button", { name: "Eliminar término de Producto B en Empaque" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Eliminar variable Producto A" }),
    );

    expect(
      screen.getByText("Se eliminó 1 restricción que quedó vacía."),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Nombre de la variable Producto A"),
    ).not.toBeInTheDocument();

    await solve(user);

    const sent = solveMock.mock.calls[0][0];
    expect(sent.variables.map((variable) => variable.id)).toEqual(["x2"]);
    expect(sent.objective.terms).toEqual([
      { variableId: "x2", coefficient: 30 },
    ]);
    expect(sent.constraints.map((constraint) => constraint.id)).toEqual([
      "machine",
      "labor",
    ]);
  });

  it("reports the plural cascade notice", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(
      screen.getByRole("button", {
        name: "Eliminar término de Producto B en Capacidad de máquina",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Eliminar término de Producto B en Mano de obra",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Eliminar variable Producto A" }),
    );

    expect(
      screen.getByText("Se eliminaron 2 restricciones que quedaron vacías."),
    ).toBeInTheDocument();
  });

  it("clears the cascade notice after the next edit", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(
      screen.getByRole("button", { name: "Eliminar término de Producto B en Empaque" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Eliminar variable Producto A" }),
    );
    expect(
      screen.getByText("Se eliminó 1 restricción que quedó vacía."),
    ).toBeInTheDocument();

    const coefficient = objectiveCoefficient("Producto B");
    await user.clear(coefficient);
    await user.type(coefficient, "35");

    expect(
      screen.queryByText("Se eliminó 1 restricción que quedó vacía."),
    ).not.toBeInTheDocument();
  });

  it("disables variable removal when it would empty the objective", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(
      screen.getByRole("button", {
        name: "Eliminar término de Producto B en la función objetivo",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Eliminar variable Producto A" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Eliminar variable Producto B" }),
    ).toBeEnabled();

    await user.click(
      screen.getByRole("button", { name: "Eliminar variable Producto B" }),
    );

    expect(
      screen.getByRole("button", { name: "Eliminar variable Producto A" }),
    ).toBeDisabled();
  });

  it("marks the previous solution stale after a structural edit", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await solve(user);

    await user.click(
      screen.getByRole("button", { name: "Eliminar restricción Empaque" }),
    );

    expect(
      screen.getByText("El modelo cambió desde la última resolución."),
    ).toBeInTheDocument();
    expect(screen.getByText("Solución anterior")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resolver nuevamente" }),
    ).toBeInTheDocument();
  });
});

describe("starting a model", () => {
  it("offers a blank model and the templates before any model exists", () => {
    render(<Sandbox />);

    expect(screen.getByRole("heading", { name: "Nuevo modelo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /En blanco/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Product Mix/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Coeficiente de/)).not.toBeInTheDocument();
  });

  it("loads a blank model with no semantics and solves it as an unbounded LP", async () => {
    const user = userEvent.setup();
    render(<Sandbox />);
    solveMock.mockResolvedValueOnce({
      status: "unbounded",
      objectiveValue: null,
      variableValues: [],
      constraints: [],
      message: null,
    });

    await user.click(screen.getByRole("button", { name: /En blanco/ }));

    expect(screen.getByText("Modelo en blanco")).toBeInTheDocument();
    expect(objectiveCoefficient("x₁")).toHaveValue("1");
    expect(objectiveCoefficient("x₂")).toHaveValue("1");
    expect(screen.queryByText("sujeto a")).not.toBeInTheDocument();
    expect(screen.queryByText("sin semántica")).not.toBeInTheDocument();
    expect(screen.getByText("Región factible no acotada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resolver modelo" }));
    await screen.findByText("Modelo no acotado");

    expect(solveMock.mock.calls[0][0]).toEqual(createBlankModel());
  });

  it("loads Product Mix with its semantic labels", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    expect(screen.getByText("Product Mix")).toBeInTheDocument();
    expect(screen.getByText("Producción · LP continuo")).toBeInTheDocument();
    expect(screen.getByText("sujeto a")).toBeInTheDocument();

    expect(within(variableRow("Producto A")).getByText("producto")).toBeInTheDocument();
    expect(within(variableRow("Producto B")).getByText("producto")).toBeInTheDocument();
    expect(screen.getAllByText("recurso")).toHaveLength(3);
    expect(screen.queryByText("sin semántica")).not.toBeInTheDocument();
  });

  it("sends only the OptimizationModel to the solver", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await solve(user);

    const sent = solveMock.mock.calls[0][0];
    expect(Object.keys(sent).sort()).toEqual([
      "constraints",
      "objective",
      "variables",
    ]);
    expect(sent).toEqual(productMixModel);
  });
});

describe("semantic bindings in the editor", () => {
  it("keeps the role of a variable renamed from Producto A to Mesas", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    const name = screen.getByLabelText("Nombre de la variable Producto A");
    await user.clear(name);
    await user.type(name, "Mesas");

    expect(within(variableRow("Mesas")).getByText("producto")).toBeInTheDocument();
    expect(screen.getAllByText("producto")).toHaveLength(2);

    await solve(user);
    expect(solveMock.mock.calls[0][0].variables[0].id).toBe("x1");
  });

  it("drops the binding of a removed variable and leaves its reused id unbound", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(
      screen.getByRole("button", { name: "Eliminar variable Producto B" }),
    );
    expect(screen.getAllByText("producto")).toHaveLength(1);

    // The highest numbered id is free again, so the next variable reuses x2.
    await user.click(screen.getByRole("button", { name: "+ Agregar variable" }));

    expect(within(variableRow("x₂")).getByText("sin semántica")).toBeInTheDocument();
    expect(screen.getAllByText("producto")).toHaveLength(1);
    expect(within(variableRow("Producto A")).getByText("producto")).toBeInTheDocument();
  });

  it("leaves a newly added variable without an invented meaning", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(screen.getByRole("button", { name: "+ Agregar variable" }));

    expect(within(variableRow("x₃")).getByText("sin semántica")).toBeInTheDocument();
    expect(screen.getAllByText("producto")).toHaveLength(2);
  });

  it("removes the tag of a removed constraint with it", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(
      screen.getByRole("button", { name: "Eliminar restricción Empaque" }),
    );

    expect(screen.getAllByText("recurso")).toHaveLength(2);
    expect(
      screen.queryByLabelText("Nombre de la restricción Empaque"),
    ).not.toBeInTheDocument();
  });
});

describe("switching models", () => {
  it("replaces the whole state when another model is chosen", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    await solve(user);
    const name = screen.getByLabelText("Nombre de la variable Producto A");
    await user.clear(name);
    await user.type(name, "Mesas");

    await user.click(screen.getByRole("button", { name: "Nuevo modelo" }));
    await user.click(screen.getByRole("button", { name: /En blanco/ }));

    expect(screen.getByText("Modelo en blanco")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Nombre de la variable Mesas"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Solución óptima")).not.toBeInTheDocument();
    expect(
      screen.queryByText("El modelo cambió desde la última resolución."),
    ).not.toBeInTheDocument();
    expect(objectiveCoefficient("x₁")).toHaveValue("1");
  });

  it("keeps the current model when the chooser is cancelled", async () => {
    const user = userEvent.setup();
    await renderProductMix(user);

    const name = screen.getByLabelText("Nombre de la variable Producto A");
    await user.clear(name);
    await user.type(name, "Mesas");

    await user.click(screen.getByRole("button", { name: "Nuevo modelo" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByLabelText("Nombre de la variable Mesas")).toHaveValue("Mesas");
  });

  it("ignores a solver response that belongs to the previous model", async () => {
    let finish!: (result: OptimizationResult) => void;
    solveMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    await renderProductMix(user);

    await user.click(screen.getByRole("button", { name: "Resolver modelo" }));
    await user.click(screen.getByRole("button", { name: "Nuevo modelo" }));
    await user.click(screen.getByRole("button", { name: /En blanco/ }));

    await act(async () => finish(optimalResult));

    expect(screen.queryByText("Solución óptima")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolver modelo" })).toBeEnabled();
  });
});
