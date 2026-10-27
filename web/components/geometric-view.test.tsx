import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sandbox } from "./sandbox";
import { GeometricView } from "./geometric-view";
import { TEMPLATES } from "@/lib/templates";
import type { OptimizationResult } from "@/lib/model";
import { solveModel } from "@/lib/solve";

const productMix = TEMPLATES[0].model;

vi.mock("@/lib/solve", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/solve")>(), solveModel: vi.fn(),
}));
const mockSolve = vi.mocked(solveModel);
const optimal: OptimizationResult = {
  status: "optimal", objectiveValue: 2200, message: null,
  variableValues: [{ variableId: "x1", value: 40 }, { variableId: "x2", value: 20 }],
  constraints: [{ constraintId: "machine", activity: 100, rhs: 100, slack: 0, active: true },
    { constraintId: "labor", activity: 80, rhs: 80, slack: 0, active: true },
    { constraintId: "packaging", activity: 60, rhs: 100, slack: 40, active: false }],
};
beforeEach(() => { mockSolve.mockReset(); mockSolve.mockResolvedValue(structuredClone(optimal)); });
// Product Mix is chosen from the start screen; the sandbox then renders its model.
function renderProductMixSandbox() {
  render(<Sandbox />);
  fireEvent.click(screen.getByRole("button", { name: /^Product Mix/ }));
}

describe("geometry in the model builder", () => {
  it("hydrates server-rendered SVG without mismatched title text", async () => {
    const props = { model: productMix, result: null, isStale: false,
      highlightedConstraintId: null, onHighlight: vi.fn() };
    const container = document.createElement("div");
    container.innerHTML = renderToString(<GeometricView {...props} />);
    document.body.appendChild(container);
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, <GeometricView {...props} />,
      { onRecoverableError: (error) => { errors.push(error); } }); });
    expect(errors).toEqual([]);
    await act(async () => root.unmount());
    container.remove();
  });
  it("updates the boundary and region immediately when a restriction changes", () => {
    renderProductMixSandbox();
    const region = screen.getByTestId("feasible-region").innerHTML;
    const line = screen.getByTestId("boundary-machine").innerHTML;
    fireEvent.change(screen.getByLabelText("Lado derecho de Capacidad de máquina"), { target: { value: "120" } });
    expect(screen.getByTestId("feasible-region").innerHTML).not.toBe(region);
    expect(screen.getByTestId("boundary-machine").innerHTML).not.toBe(line);
    expect(mockSolve).not.toHaveBeenCalled();
  });
  it("uses only the current solver result for the marker and active restrictions", async () => {
    const user = userEvent.setup();
    renderProductMixSandbox();
    expect(screen.queryByTestId("optimal-point")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resolver modelo" }));
    const point = await screen.findByTestId("optimal-point");
    expect(point).toHaveAttribute("data-x", "40");
    expect(point).toHaveAttribute("data-y", "20");
    expect(screen.getByTestId("boundary-machine")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("boundary-packaging")).toHaveAttribute("data-active", "false");
    fireEvent.change(screen.getByLabelText("Lado derecho de Capacidad de máquina"), { target: { value: "120" } });
    expect(screen.queryByTestId("optimal-point")).not.toBeInTheDocument();
    expect(screen.getByTestId("boundary-machine")).toHaveAttribute("data-active", "false");
    expect(screen.getByText(/Óptimo anterior oculto/)).toBeInTheDocument();
    mockSolve.mockResolvedValueOnce({ ...optimal, objectiveValue: 7600 / 3,
      variableValues: [{ variableId: "x1", value: 160 / 3 }, { variableId: "x2", value: 40 / 3 }] });
    await user.click(screen.getByRole("button", { name: "Resolver nuevamente" }));
    await waitFor(() => expect(screen.getByTestId("optimal-point")).toHaveAttribute("data-x", String(160 / 3)));
    expect(screen.queryByText(/Óptimo anterior oculto/)).not.toBeInTheDocument();
    expect(mockSolve.mock.calls[1][0].constraints[0].rhs).toBe(120);
  });
  it("hides stale markers after a structural edit or renaming", async () => {
    const user = userEvent.setup();
    renderProductMixSandbox();
    await user.click(screen.getByRole("button", { name: "Resolver modelo" }));
    await screen.findByTestId("optimal-point");
    fireEvent.change(screen.getByLabelText("Nombre de la restricción Empaque"), { target: { value: "Embalaje" } });
    expect(screen.queryByTestId("optimal-point")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resolver nuevamente" }));
    await screen.findByTestId("optimal-point");
    await user.click(screen.getByRole("button", { name: "Eliminar restricción Embalaje" }));
    expect(screen.queryByTestId("optimal-point")).not.toBeInTheDocument();
    expect(screen.getByText(/Óptimo anterior oculto/)).toBeInTheDocument();
  });
  it("keeps late solver responses tied to their original snapshot", async () => {
    let finish!: (result: OptimizationResult) => void;
    mockSolve.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    renderProductMixSandbox();
    await user.click(screen.getByRole("button", { name: "Resolver modelo" }));
    fireEvent.change(screen.getByLabelText("Lado derecho de Empaque"), { target: { value: "90" } });
    finish(optimal);
    await screen.findByText(/Óptimo anterior oculto/);
    expect(screen.queryByTestId("optimal-point")).not.toBeInTheDocument();
  });
  it("explains unsupported dimensions and restores the plot when there are two variables", async () => {
    const user = userEvent.setup();
    renderProductMixSandbox();
    await user.click(screen.getByRole("button", { name: "+ Agregar variable" }));
    expect(screen.getByText(/exactamente dos variables.*tiene 3/)).toBeInTheDocument();
    expect(screen.queryByTestId("feasible-region")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Eliminar variable x₃" }));
    expect(screen.getByTestId("feasible-region")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Eliminar variable Producto B" }));
    expect(screen.getByText(/exactamente dos variables.*tiene 1/)).toBeInTheDocument();
  });
  it("links editor hover, geometric boundaries, and keyboard exploration by constraint id", async () => {
    const user = userEvent.setup();
    renderProductMixSandbox();
    const field = screen.getByLabelText("Lado derecho de Capacidad de máquina");
    const row = field.closest("li")!;
    await user.hover(row);
    expect(screen.getByTestId("boundary-machine")).toHaveAttribute("data-highlighted", "true");
    expect(screen.getByTestId("allowed-halfplane")).toBeInTheDocument();
    await user.unhover(row);
    await user.hover(screen.getByTestId("boundary-labor"));
    expect(screen.getByLabelText("Lado derecho de Mano de obra").closest("li")).toHaveClass("is-highlighted");
    fireEvent.focus(screen.getByRole("button", { name: "Explorar frontera: Empaque" }));
    expect(screen.getByTestId("boundary-packaging")).toHaveAttribute("data-highlighted", "true");
    await user.click(screen.getByRole("button", { name: "Explorar frontera: Producto A ≥ 0" }));
    expect(screen.getByTestId("allowed-halfplane")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explorar frontera: Producto A ≥ 0" })).toHaveAttribute("aria-pressed", "true");
  });
  it("shows an infeasible state without fabricating a region or waiting for the solver", () => {
    renderProductMixSandbox();
    fireEvent.change(screen.getByLabelText("Lado derecho de Capacidad de máquina"), { target: { value: "-1" } });
    expect(screen.getByText("Sin región factible")).toBeInTheDocument();
    expect(screen.queryByTestId("feasible-region")).not.toBeInTheDocument();
    expect(mockSolve).not.toHaveBeenCalled();
  });
  it("shows an unbounded region after removing explicit restrictions", async () => {
    const user = userEvent.setup();
    renderProductMixSandbox();
    for (const name of ["Capacidad de máquina", "Mano de obra", "Empaque"]) {
      await user.click(screen.getByRole("button", { name: `Eliminar restricción ${name}` }));
    }
    expect(screen.getByText("Región factible no acotada")).toBeInTheDocument();
    expect(screen.getByTestId("feasible-region")).toBeInTheDocument();
    expect(screen.getByText(/Sus bordes de recorte no son restricciones/)).toBeInTheDocument();
  });
  it("renders vertical and negative constraints and equality without a halfplane", async () => {
    const user = userEvent.setup();
    renderProductMixSandbox();
    await user.click(screen.getByRole("button", { name: "+ Agregar restricción" }));
    fireEvent.change(screen.getByLabelText("Lado derecho de Restricción 4"), { target: { value: "20" } });
    expect(screen.getByTestId("boundary-constraint1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Coeficiente de Producto A en Restricción 4"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText("Lado derecho de Restricción 4"), { target: { value: "-5" } });
    expect(screen.getByTestId("feasible-region")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Operador de Restricción 4"), "=");
    fireEvent.focus(screen.getByLabelText("Lado derecho de Restricción 4"));
    expect(screen.queryByTestId("allowed-halfplane")).not.toBeInTheDocument();
    expect(screen.getByTestId("feasible-region").tagName.toLowerCase()).toBe("polyline");
  });
  it("defensively excludes stale points and supports non-optimal solver states", () => {
    const props = { model: productMix, isStale: true, highlightedConstraintId: null, onHighlight: vi.fn() };
    const { rerender } = render(<GeometricView {...props} result={optimal} />);
    expect(screen.queryByTestId("optimal-point")).not.toBeInTheDocument();
    for (const status of ["infeasible", "unbounded", "error"] as const) {
      rerender(<GeometricView {...props} isStale={false} result={{ status, objectiveValue: null,
        variableValues: [], constraints: [], message: null }} />);
      expect(screen.queryByTestId("optimal-point")).not.toBeInTheDocument();
    }
  });
});
