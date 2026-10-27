import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "@/components/sandbox";
import { ProductMixScenarioView } from "@/components/scenario/product-mix-view";
import { NO_HIGHLIGHT } from "@/lib/highlight";
import { TEMPLATES } from "@/lib/templates";
import type { ProductMixCanvasProps } from "@/components/scenario/product-mix-canvas";
import type { OptimizationResult } from "@/lib/model";
import { solveModel } from "@/lib/solve";
import { supportsWebGL } from "@/lib/webgl";

// WebGL cannot run in jsdom. The renderer boundary is replaced by a stand-in
// that exposes what it was given, so the tests check the data that reaches the
// 3D scene and the behaviour around it, not the pixels.
const canvas = vi.hoisted(() => ({
  fail: false,
  mounted: 0,
  lastProps: null as ProductMixCanvasProps | null,
}));

vi.mock("@/components/scenario/product-mix-canvas", () => ({
  default: function MockCanvas(props: ProductMixCanvasProps) {
    if (canvas.fail) {
      throw new Error("WebGL renderer failed");
    }
    canvas.lastProps = props;
    useEffect(() => {
      canvas.mounted += 1;
      return () => {
        canvas.mounted -= 1;
      };
    }, []);
    return (
      <div data-testid="scene-canvas">
        {props.layout.resources.map((placed) => (
          <span
            key={placed.resource.constraintId}
            data-testid={`vessel-${placed.resource.constraintId}`}
            data-fill={placed.fillHeight}
            data-segments={placed.segments.length}
          />
        ))}
        {props.layout.products.map((placed) => (
          <span
            key={placed.product.variableId}
            data-testid={`column-${placed.product.variableId}`}
            data-height={placed.height}
          />
        ))}
        <button
          type="button"
          onMouseEnter={() =>
            props.onHighlight({ constraintId: "machine", variableId: "x1" })
          }
        >
          canal 3D máquina–A
        </button>
      </div>
    );
  },
}));

vi.mock("@/lib/webgl", () => ({ supportsWebGL: vi.fn(() => true) }));

vi.mock("@/lib/solve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/solve")>()),
  solveModel: vi.fn(),
}));

const solveMock = vi.mocked(solveModel);
const webglMock = vi.mocked(supportsWebGL);

const optimal: OptimizationResult = {
  status: "optimal",
  objectiveValue: 2200,
  variableValues: [
    { variableId: "x1", value: 40 },
    { variableId: "x2", value: 20 },
  ],
  constraints: [
    { constraintId: "machine", activity: 100, rhs: 100, slack: 0, active: true },
    { constraintId: "labor", activity: 80, rhs: 80, slack: 0, active: true },
    { constraintId: "packaging", activity: 60, rhs: 100, slack: 40, active: false },
  ],
  message: null,
};

beforeEach(() => {
  canvas.fail = false;
  canvas.mounted = 0;
  canvas.lastProps = null;
  webglMock.mockReturnValue(true);
  solveMock.mockReset();
  solveMock.mockResolvedValue(structuredClone(optimal));
});

type User = ReturnType<typeof userEvent.setup>;

async function openProductMix(user: User) {
  render(<Sandbox />);
  await user.click(screen.getByRole("button", { name: /^Product Mix/ }));
}

async function showScenario(user: User) {
  await user.click(screen.getByRole("tab", { name: "Escenario" }));
  await screen.findByTestId("scene-canvas");
}

async function solve(user: User) {
  await user.click(screen.getByRole("button", { name: "Resolver modelo" }));
  await screen.findByText("Solución óptima");
}

function resourceRow(constraintId: string) {
  return screen.getByTestId(`scene-resource-${constraintId}`);
}

function productRow(variableId: string) {
  return screen.getByTestId(`scene-product-${variableId}`);
}

describe("visualization tabs", () => {
  it("offers Geometría and Escenario for Product Mix, with geometry first", async () => {
    const user = userEvent.setup();
    await openProductMix(user);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Geometría", "Escenario"]);
    expect(screen.getByRole("tab", { name: "Geometría" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("feasible-region")).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-view")).not.toBeInTheDocument();
  });

  it("offers only Geometría for a blank model", async () => {
    const user = userEvent.setup();
    render(<Sandbox />);
    await user.click(screen.getByRole("button", { name: /^En blanco/ }));

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Geometría",
    ]);
    expect(screen.queryByTestId("scenario-view")).not.toBeInTheDocument();
  });

  it("keeps the model when switching between views", async () => {
    const user = userEvent.setup();
    await openProductMix(user);

    const rhs = screen.getByLabelText("Lado derecho de Capacidad de máquina");
    await user.clear(rhs);
    await user.type(rhs, "120");
    await showScenario(user);

    expect(within(resourceRow("machine")).getByText("capacidad 120")).toBeInTheDocument();
    expect(screen.queryByTestId("feasible-region")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Geometría" }));
    expect(screen.getByTestId("feasible-region")).toBeInTheDocument();
    expect(canvas.mounted).toBe(0);
    expect(
      screen.getByLabelText("Lado derecho de Capacidad de máquina"),
    ).toHaveValue("120");
  });

  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    await openProductMix(user);

    screen.getByRole("tab", { name: "Geometría" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Escenario" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("scene-canvas")).toBeInTheDocument();
  });
});

describe("the modelled system before solving", () => {
  it("shows resources, capacities and consumption relations from the model", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    expect(screen.getByText(/sin resolver/)).toBeInTheDocument();
    const machine = resourceRow("machine");
    expect(within(machine).getByText("capacidad 100")).toBeInTheDocument();
    expect(
      within(machine).getByRole("button", {
        name: "Relación: Producto A usa 2 de Capacidad de máquina",
      }),
    ).toBeInTheDocument();
    expect(within(productRow("x1")).getByText("aporte a Z 40 /u")).toBeInTheDocument();
    expect(canvas.lastProps!.layout.channels).toHaveLength(6);

    // No solution data is invented.
    expect(within(machine).queryByText(/uso/)).not.toBeInTheDocument();
    expect(screen.getByTestId("vessel-machine")).toHaveAttribute("data-fill", "0");
    expect(screen.getByTestId("column-x1")).toHaveAttribute("data-height", "0");
  });

  it("updates a relation immediately when its coefficient is edited", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    fireEvent.change(
      screen.getByLabelText("Coeficiente de Producto A en Capacidad de máquina"),
      { target: { value: "4" } },
    );

    expect(
      screen.getByRole("button", {
        name: "Relación: Producto A usa 4 de Capacidad de máquina",
      }),
    ).toBeInTheDocument();
    expect(solveMock).not.toHaveBeenCalled();
  });

  it("follows renames in the scene labels", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    const name = screen.getByLabelText("Nombre de la variable Producto A");
    await user.clear(name);
    await user.type(name, "Mesas");

    expect(within(productRow("x1")).getByRole("button", { name: "Mesas" })).toBeInTheDocument();
    expect(
      canvas.lastProps!.labels.some((label) => label.title === "Mesas"),
    ).toBe(true);
  });

  it("reports math without semantics instead of inventing a meaning", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    await user.click(screen.getByRole("button", { name: "+ Agregar variable" }));

    expect(
      screen.getByText("1 entidad del modelo no tiene representación en este escenario."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("scene-product-x3")).not.toBeInTheDocument();
  });

  it("stops representing a removed product", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    await user.click(screen.getByRole("button", { name: "Eliminar variable Producto B" }));

    expect(screen.queryByTestId("scene-product-x2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("column-x2")).not.toBeInTheDocument();
    expect(canvas.lastProps!.layout.channels).toHaveLength(3);
  });
});

describe("the solution state on the scene", () => {
  it("adds quantities, use per product and active resources after solving", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);
    await solve(user);

    expect(screen.getByText(/Solución vigente de HiGHS/)).toBeInTheDocument();
    expect(within(productRow("x1")).getByText("cantidad 40")).toBeInTheDocument();
    expect(within(productRow("x2")).getByText("cantidad 20")).toBeInTheDocument();
    expect(
      within(resourceRow("machine")).getByText(/uso 100 = 80 \+ 20 · 100 %/),
    ).toBeInTheDocument();
    expect(resourceRow("machine")).toHaveAttribute("data-active", "true");
    expect(resourceRow("labor")).toHaveAttribute("data-active", "true");
    expect(resourceRow("packaging")).toHaveAttribute("data-active", "false");
    expect(within(resourceRow("packaging")).getByText(/60 %/)).toBeInTheDocument();
    expect(within(resourceRow("packaging")).getByText(/holgura 40/)).toBeInTheDocument();
    expect(screen.getByTestId("vessel-machine")).toHaveAttribute("data-segments", "2");
  });

  it("drops every solution value as soon as the model is edited", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);
    await solve(user);

    fireEvent.change(screen.getByLabelText("Lado derecho de Capacidad de máquina"), {
      target: { value: "120" },
    });

    expect(
      screen.getByText("El modelo cambió: la solución anterior no corresponde a este sistema."),
    ).toBeInTheDocument();
    expect(screen.queryByText("cantidad 40")).not.toBeInTheDocument();
    expect(resourceRow("machine")).not.toHaveAttribute("data-active");
    expect(screen.getByTestId("vessel-machine")).toHaveAttribute("data-fill", "0");
    expect(screen.getByTestId("column-x1")).toHaveAttribute("data-height", "0");
    expect(within(resourceRow("machine")).getByText("capacidad 120")).toBeInTheDocument();
  });

  it("solves again from the scene and shows only the new solution", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);
    await solve(user);
    fireEvent.change(screen.getByLabelText("Lado derecho de Capacidad de máquina"), {
      target: { value: "120" },
    });
    solveMock.mockResolvedValueOnce({
      ...optimal,
      objectiveValue: 2533.3333333,
      variableValues: [
        { variableId: "x1", value: 53.3333333 },
        { variableId: "x2", value: 13.3333333 },
      ],
      constraints: [
        { constraintId: "machine", activity: 120, rhs: 120, slack: 0, active: true },
        { constraintId: "labor", activity: 80, rhs: 80, slack: 0, active: true },
        { constraintId: "packaging", activity: 66.6666666, rhs: 100, slack: 33.3333334, active: false },
      ],
    });

    await user.click(
      within(screen.getByTestId("scenario-view")).getByRole("button", {
        name: "Resolver nuevamente",
      }),
    );

    expect(await within(productRow("x1")).findByText("cantidad 53,3333")).toBeInTheDocument();
    expect(solveMock.mock.calls[1][0].constraints[0].rhs).toBe(120);
    expect(within(resourceRow("machine")).getByText(/uso 120/)).toBeInTheDocument();
    expect(screen.queryByText("cantidad 40")).not.toBeInTheDocument();
  });

  it.each([
    ["infeasible", /Modelo infactible/],
    ["unbounded", /Modelo no acotado/],
  ] as const)("keeps the system but shows no quantities when %s", async (status, copy) => {
    solveMock.mockResolvedValue({
      status,
      objectiveValue: null,
      variableValues: [],
      constraints: [],
      message: null,
    });
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);
    await user.click(screen.getByRole("button", { name: "Resolver modelo" }));

    expect(await within(screen.getByTestId("scenario-view")).findByText(copy)).toBeInTheDocument();
    expect(within(resourceRow("machine")).getByText("capacidad 100")).toBeInTheDocument();
    expect(screen.queryByText(/^cantidad /)).not.toBeInTheDocument();
    expect(screen.getByTestId("scene-canvas")).toBeInTheDocument();
  });
});

describe("highlighting across the editor and the scene", () => {
  it("highlights the constraint in the editor when a resource is explored", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    await user.hover(within(resourceRow("labor")).getByRole("button", { name: "Mano de obra" }));

    expect(document.querySelector('li[data-constraint-id="labor"]')).toHaveClass(
      "is-highlighted",
    );
    expect(screen.getByText(/Mano de obra: capacidad 80/)).toBeInTheDocument();
  });

  it("marks the resource in the scene when its constraint is hovered in the editor", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    await user.hover(
      document.querySelector('li[data-constraint-id="packaging"]') as HTMLElement,
    );

    expect(
      within(resourceRow("packaging")).getByRole("button", { name: "Empaque" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(canvas.lastProps!.highlight).toEqual({
      constraintId: "packaging",
      variableId: null,
    });
  });

  it("highlights the exact term when a 3D relation is hovered", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    await user.hover(screen.getByRole("button", { name: "canal 3D máquina–A" }));

    const machine = document.querySelector('li[data-constraint-id="machine"]')!;
    expect(machine.querySelector('[data-variable-id="x1"]')).toHaveClass("is-highlighted");
    expect(machine.querySelector('[data-variable-id="x2"]')).not.toHaveClass(
      "is-highlighted",
    );
    expect(
      screen.getByText(/Límite teórico impuesto por este recurso: 50 unidades/),
    ).toBeInTheDocument();
  });

  it("passes a hovered editor term to the scene as a relation", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    const labor = document.querySelector('li[data-constraint-id="labor"]')!;
    await user.hover(labor.querySelector('[data-variable-id="x2"]') as HTMLElement);

    expect(canvas.lastProps!.highlight).toEqual({
      constraintId: "labor",
      variableId: "x2",
    });
  });
});

describe("scene lifecycle and failures", () => {
  it("unmounts the scene when another model replaces the workspace", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);
    expect(canvas.mounted).toBe(1);

    await user.click(screen.getByRole("button", { name: "Nuevo modelo" }));
    await user.click(screen.getByRole("button", { name: /^En blanco/ }));

    expect(canvas.mounted).toBe(0);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Geometría",
    ]);
    expect(screen.getByTestId("feasible-region")).toBeInTheDocument();
  });

  it("remembers the chosen view during the session", async () => {
    const user = userEvent.setup();
    await openProductMix(user);
    await showScenario(user);

    await user.click(screen.getByRole("button", { name: "Nuevo modelo" }));
    await user.click(screen.getByRole("button", { name: /^En blanco/ }));
    await user.click(screen.getByRole("button", { name: "Nuevo modelo" }));
    await user.click(screen.getByRole("button", { name: /^Product Mix/ }));

    expect(screen.getByRole("tab", { name: "Escenario" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("scene-canvas")).toBeInTheDocument();
    expect(screen.getByText(/sin resolver/)).toBeInTheDocument();
  });

  it("keeps the editor and solver usable when the renderer fails", async () => {
    canvas.fail = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    await openProductMix(user);
    await user.click(screen.getByRole("tab", { name: "Escenario" }));

    expect(await screen.findByText("No se pudo iniciar la vista 3D.")).toBeInTheDocument();
    expect(
      screen.getByText("La vista geométrica y el modelo siguen disponibles."),
    ).toBeInTheDocument();
    // The textual system stays readable without WebGL.
    expect(within(resourceRow("machine")).getByText("capacidad 100")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Lado derecho de Mano de obra"), {
      target: { value: "90" },
    });
    await solve(user);
    expect(solveMock.mock.calls[0][0].constraints[1].rhs).toBe(90);

    await user.click(screen.getByRole("tab", { name: "Geometría" }));
    expect(screen.getByTestId("feasible-region")).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("shows the fallback without mounting the renderer when WebGL is unavailable", async () => {
    webglMock.mockReturnValue(false);
    const user = userEvent.setup();
    await openProductMix(user);
    await user.click(screen.getByRole("tab", { name: "Escenario" }));

    expect(screen.getByText("No se pudo iniciar la vista 3D.")).toBeInTheDocument();
    await act(async () => {});
    expect(canvas.mounted).toBe(0);
  });

  it("renders on the server without touching WebGL", () => {
    webglMock.mockClear();
    const { model, scenario } = TEMPLATES[0];
    const html = renderToString(
      <ProductMixScenarioView
        model={model}
        scenario={scenario}
        solved={null}
        isSolving={false}
        highlight={NO_HIGHLIGHT}
        onHighlight={() => {}}
        onResolve={() => {}}
      />,
    );

    expect(webglMock).not.toHaveBeenCalled();
    expect(html).toContain("Preparando la vista 3D");
    expect(html).toContain("capacidad 100");
  });
});
