"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useSyncExternalStore } from "react";

import type { ScenarioViewProps } from "@/components/scenario-views";
import { formatNumber } from "@/lib/format";
import { NO_HIGHLIGHT, type Highlight } from "@/lib/highlight";
import {
  FLOOR,
  layoutProductMixScene,
  type FloorLayout,
} from "@/lib/product-mix-layout";
import {
  buildProductMixScene,
  type CapacityIssue,
  type ProductMixScene,
  type ResourceState,
  type ProductState,
} from "@/lib/product-mix-scene";
import { supportsWebGL } from "@/lib/webgl";
import type { SceneLabel } from "./product-mix-canvas";
import { SceneErrorBoundary } from "./scene-error-boundary";
import { productTone, UNREPRESENTED_TONE } from "./tones";

// The WebGL renderer is a separate client-only chunk: it is never evaluated on
// the server and only downloaded when a scenario view is shown.
const ProductMixCanvas = dynamic(() => import("./product-mix-canvas"), {
  ssr: false,
  loading: () => <p className="scene-loading">Preparando la vista 3D…</p>,
});

const ISSUE_COPY: Record<CapacityIssue, string> = {
  operator: "su operador no es ≤",
  "negative-capacity": "su lado derecho es negativo",
  "negative-consumption": "un producto tiene coeficiente negativo",
  "product-domain": "un producto admite cantidades negativas",
};

const percentFormatter = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 1,
});

function formatPercent(ratio: number): string {
  return `${percentFormatter.format(ratio * 100)} %`;
}

const noSubscription = () => () => {};

/** Production Floor: the modelled system first, the current solution on top. */
export function ProductMixScenarioView({
  model,
  scenario,
  solved,
  isSolving,
  highlight,
  onHighlight,
  onResolve,
}: ScenarioViewProps) {
  const scene = useMemo(
    () => buildProductMixScene(model, scenario, solved),
    [model, scenario, solved],
  );
  const layout = useMemo(() => layoutProductMixScene(scene), [scene]);
  const labels = useMemo(
    () => sceneLabels(scene, layout, highlight),
    [scene, layout, highlight],
  );
  // null while rendering on the server or hydrating; never touches WebGL there.
  const webgl = useSyncExternalStore(noSubscription, supportsWebGL, () => null);
  const [contextLost, setContextLost] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const { definition } = scene;
  const isEmpty =
    definition.products.length === 0 && definition.resources.length === 0;
  const names = entityNames(scene);
  const caption = describeHighlight(scene, highlight, names);
  const failure = (
    <div className="scene-fallback" role="status">
      <p>No se pudo iniciar la vista 3D.</p>
      <p>La vista geométrica y el modelo siguen disponibles.</p>
    </div>
  );

  return (
    <div className="scenario-view" data-testid="scenario-view">
      <SolutionStatus
        scene={scene}
        isSolving={isSolving}
        onResolve={onResolve}
      />

      {isEmpty ? (
        <div className="scene-fallback" role="status">
          <p>Ninguna entidad del modelo tiene representación en este escenario.</p>
        </div>
      ) : webgl === null ? (
        <p className="scene-loading">Preparando la vista 3D…</p>
      ) : !webgl || contextLost ? (
        failure
      ) : (
        <SceneErrorBoundary fallback={failure}>
          <ProductMixCanvas
            layout={layout}
            labels={labels}
            highlight={highlight}
            onHighlight={onHighlight}
            resetKey={resetKey}
            onContextLost={() => setContextLost(true)}
          />
        </SceneErrorBoundary>
      )}

      {!isEmpty ? (
        <div className="scene-toolbar">
          <p className="scene-caption" aria-live="polite">
            {caption ??
              "Pasa sobre un recurso, un producto o una relación para explorar el sistema."}
          </p>
          {webgl && !contextLost ? (
            <button
              type="button"
              className="text-button"
              onClick={() => setResetKey((key) => key + 1)}
            >
              Restablecer vista
            </button>
          ) : null}
        </div>
      ) : null}

      <SystemReadout
        scene={scene}
        names={names}
        highlight={highlight}
        onHighlight={onHighlight}
      />

      {definition.unboundCount > 0 ? (
        <p className="scene-unbound" role="note">
          {definition.unboundCount === 1
            ? "1 entidad del modelo no tiene representación en este escenario."
            : `${definition.unboundCount} entidades del modelo no tienen representación en este escenario.`}
        </p>
      ) : null}
    </div>
  );
}

function SolutionStatus({
  scene,
  isSolving,
  onResolve,
}: {
  scene: ProductMixScene;
  isSolving: boolean;
  onResolve: () => void;
}) {
  const { solution } = scene;

  if (isSolving) {
    return (
      <p className="scene-status" role="status">
        Resolviendo con HiGHS…
      </p>
    );
  }

  switch (solution.state) {
    case "unsolved":
      return (
        <p className="scene-status" role="status">
          Sistema definido por el modelo · sin resolver
        </p>
      );
    case "stale":
      return (
        <div className="scene-status scene-status-stale" role="status">
          <p>El modelo cambió: la solución anterior no corresponde a este sistema.</p>
          <button type="button" className="text-button" onClick={onResolve}>
            Resolver nuevamente
          </button>
        </div>
      );
    case "optimal":
      return (
        <p className="scene-status scene-status-optimal" role="status">
          Solución vigente de HiGHS ·{" "}
          <span className="formula">Z = {formatNumber(solution.objectiveValue)}</span>
        </p>
      );
    case "infeasible":
      return (
        <p className="scene-status scene-status-problem" role="status">
          Modelo infactible: ninguna producción cumple todas las restricciones. No
          hay cantidades que mostrar.
        </p>
      );
    case "unbounded":
      return (
        <p className="scene-status scene-status-problem" role="status">
          Modelo no acotado: el objetivo mejora sin límite. No hay cantidades
          finitas que mostrar.
        </p>
      );
    case "error":
      return (
        <div className="scene-status scene-status-problem" role="status">
          <p>HiGHS no devolvió una solución concluyente.</p>
          {solution.message ? (
            <p className="technical-note">{solution.message}</p>
          ) : null}
        </div>
      );
  }
}

interface EntityNames {
  products: Map<string, string>;
  resources: Map<string, string>;
}

function entityNames(scene: ProductMixScene): EntityNames {
  return {
    products: new Map(
      scene.definition.products.map((product) => [
        product.variableId,
        product.name,
      ]),
    ),
    resources: new Map(
      scene.definition.resources.map((resource) => [
        resource.constraintId,
        resource.name,
      ]),
    ),
  };
}

function solutionStates(scene: ProductMixScene): {
  products: Map<string, ProductState>;
  resources: Map<string, ResourceState>;
} {
  const optimal = scene.solution.state === "optimal" ? scene.solution : null;
  return {
    products: new Map(
      optimal?.products.map((state) => [state.variableId, state]),
    ),
    resources: new Map(
      optimal?.resources.map((state) => [state.constraintId, state]),
    ),
  };
}

/** Text anchored in the scene; numbers always show their true values. */
function sceneLabels(
  scene: ProductMixScene,
  layout: FloorLayout,
  highlight: Highlight,
): SceneLabel[] {
  const resourceLabels = layout.resources.map((placed) => {
    const { resource, state } = placed;
    let lines: string[];
    if (resource.capacityIssues.length > 0) {
      lines = ["no interpretable como capacidad"];
    } else if (state) {
      lines = [
        state.utilization === null
          ? `uso ${formatNumber(state.activity)} · capacidad ${formatNumber(resource.capacity)}`
          : `${formatNumber(state.activity)} / ${formatNumber(resource.capacity)} · ${formatPercent(state.utilization)}`,
        state.active ? "ACTIVA" : `holgura ${formatNumber(state.slack)}`,
      ];
    } else {
      lines = [`capacidad ${formatNumber(resource.capacity)}`];
    }
    return {
      key: `resource:${resource.constraintId}`,
      kind: "resource" as const,
      anchor: [placed.x, 0.1 + FLOOR.vesselHeight + 0.18, placed.z] as [
        number,
        number,
        number,
      ],
      title: resource.name,
      lines,
      emphasis:
        highlight.constraintId === resource.constraintId &&
        highlight.variableId === null,
    };
  });

  const productLabels = layout.products.map((placed) => {
    const { product, state } = placed;
    const contribution = `aporte a Z ${formatNumber(product.objectiveCoefficient)} /u`;
    return {
      key: `product:${product.variableId}`,
      kind: "product" as const,
      anchor: [placed.x, 0.06 + placed.height + 0.12, placed.z] as [
        number,
        number,
        number,
      ],
      title: product.name,
      lines: state
        ? [`cantidad ${formatNumber(state.quantity)}`, contribution]
        : [contribution],
      emphasis:
        highlight.variableId === product.variableId &&
        highlight.constraintId === null,
    };
  });

  // Coefficient of each relation, near the resource it is consumed from.
  const channelLabels = layout.channels.map((channel) => {
    const { constraintId, variableId, coefficient } = channel.consumption;
    const t = 0.3;
    return {
      key: `channel:${constraintId}:${variableId}`,
      kind: "channel" as const,
      anchor: [
        channel.to[0] + (channel.from[0] - channel.to[0]) * t,
        0.02,
        channel.to[1] + (channel.from[1] - channel.to[1]) * t,
      ] as [number, number, number],
      title: formatNumber(coefficient),
      lines: [],
      emphasis:
        (highlight.constraintId !== null || highlight.variableId !== null) &&
        (highlight.constraintId === null ||
          highlight.constraintId === constraintId) &&
        (highlight.variableId === null || highlight.variableId === variableId),
    };
  });

  return [...channelLabels, ...resourceLabels, ...productLabels];
}

/** One sentence about the highlighted entity or relation, in model terms. */
function describeHighlight(
  scene: ProductMixScene,
  highlight: Highlight,
  names: EntityNames,
): string | null {
  const { definition } = scene;
  const states = solutionStates(scene);
  const { constraintId, variableId } = highlight;

  if (constraintId && variableId) {
    const consumption = definition.consumptions.find(
      (item) =>
        item.constraintId === constraintId && item.variableId === variableId,
    );
    if (!consumption) {
      return null;
    }
    const product = names.products.get(variableId)!;
    const resource = names.resources.get(constraintId)!;
    const parts = [
      `${product} usa ${formatNumber(consumption.coefficient)} de ${resource} por unidad.`,
    ];
    if (consumption.resourceLimit !== null) {
      parts.push(
        `Límite teórico impuesto por este recurso: ${formatNumber(consumption.resourceLimit)} unidades.`,
      );
    }
    const share = states.resources
      .get(constraintId)
      ?.shares.find((item) => item.variableId === variableId);
    if (share) {
      parts.push(`En la solución vigente usa ${formatNumber(share.amount)}.`);
    }
    return parts.join(" ");
  }

  if (constraintId) {
    const resource = definition.resources.find(
      (item) => item.constraintId === constraintId,
    );
    if (!resource) {
      return null;
    }
    const users = definition.consumptions
      .filter((item) => item.constraintId === constraintId)
      .map(
        (item) =>
          `${names.products.get(item.variableId)} (${formatNumber(item.coefficient)}/u)`,
      );
    const parts =
      resource.capacityIssues.length > 0
        ? [
            `${resource.name} no es interpretable como capacidad: ${resource.capacityIssues
              .map((issue) => ISSUE_COPY[issue])
              .join("; ")}.`,
          ]
        : [`${resource.name}: capacidad ${formatNumber(resource.capacity)}.`];
    if (users.length > 0) {
      parts.push(`La usan ${users.join(" y ")}.`);
    }
    const state = states.resources.get(constraintId);
    if (state) {
      parts.push(
        `Uso vigente ${formatNumber(state.activity)}${state.active ? " · activa" : ` · holgura ${formatNumber(state.slack)}`}.`,
      );
    }
    return parts.join(" ");
  }

  if (variableId) {
    const product = definition.products.find(
      (item) => item.variableId === variableId,
    );
    if (!product) {
      return null;
    }
    const uses = definition.consumptions
      .filter((item) => item.variableId === variableId)
      .map(
        (item) =>
          `${names.resources.get(item.constraintId)} ${formatNumber(item.coefficient)}`,
      );
    const parts = [
      `${product.name}: variable de decisión; aporte a Z por unidad ${formatNumber(product.objectiveCoefficient)}.`,
    ];
    if (uses.length > 0) {
      parts.push(`Usa por unidad: ${uses.join(", ")}.`);
    }
    const state = states.products.get(variableId);
    if (state) {
      parts.push(`Cantidad vigente ${formatNumber(state.quantity)}.`);
    }
    return parts.join(" ");
  }

  return null;
}

/**
 * The same system as text: every entity, relation and solution value. It
 * keeps the scenario readable without WebGL and lets keyboard users explore.
 */
function SystemReadout({
  scene,
  names,
  highlight,
  onHighlight,
}: {
  scene: ProductMixScene;
  names: EntityNames;
  highlight: Highlight;
  onHighlight: (highlight: Highlight) => void;
}) {
  const { definition } = scene;
  const states = solutionStates(scene);
  const tones = new Map(
    definition.products.map((product, index) => [
      product.variableId,
      productTone(index),
    ]),
  );

  function explore(target: Highlight) {
    return {
      onMouseEnter: () => onHighlight(target),
      onMouseLeave: () => onHighlight(NO_HIGHLIGHT),
      onFocus: () => onHighlight(target),
      onBlur: () => onHighlight(NO_HIGHLIGHT),
    };
  }

  return (
    <div className="system-readout">
      {definition.resources.length > 0 ? (
        <section className="system-group" aria-label="Recursos del sistema">
          <h3>Recursos</h3>
          <ul>
            {definition.resources.map((resource) => {
              const state = states.resources.get(resource.constraintId);
              const pressed =
                highlight.constraintId === resource.constraintId &&
                highlight.variableId === null;
              const consumptions = definition.consumptions.filter(
                (item) => item.constraintId === resource.constraintId,
              );
              const explained =
                state?.decompositionMatches === true &&
                state.unrepresentedAmount >= 0 &&
                state.shares.every((share) => share.amount >= 0);

              return (
                <li
                  key={resource.constraintId}
                  data-testid={`scene-resource-${resource.constraintId}`}
                  data-active={state ? String(state.active) : undefined}
                >
                  <button
                    type="button"
                    className="system-entity"
                    aria-pressed={pressed}
                    {...explore({
                      constraintId: resource.constraintId,
                      variableId: null,
                    })}
                  >
                    {resource.name}
                  </button>
                  <span className="system-fact formula">
                    {resource.capacityIssues.length > 0
                      ? `no interpretable como capacidad: ${resource.capacityIssues
                          .map((issue) => ISSUE_COPY[issue])
                          .join("; ")}`
                      : `capacidad ${formatNumber(resource.capacity)}`}
                  </span>
                  <span className="system-relations">
                    {consumptions.map((item) => (
                      <button
                        key={item.variableId}
                        type="button"
                        className="system-relation formula"
                        aria-label={`Relación: ${names.products.get(item.variableId)} usa ${formatNumber(item.coefficient)} de ${resource.name}`}
                        aria-pressed={
                          highlight.constraintId === item.constraintId &&
                          highlight.variableId === item.variableId
                        }
                        {...explore({
                          constraintId: item.constraintId,
                          variableId: item.variableId,
                        })}
                      >
                        <i
                          className="system-swatch"
                          style={{ background: tones.get(item.variableId) }}
                          aria-hidden="true"
                        />
                        {formatNumber(item.coefficient)}·{names.products.get(item.variableId)}
                      </button>
                    ))}
                    {resource.unrepresentedVariableIds.length > 0 ? (
                      <span className="system-relation is-unbound">
                        <i
                          className="system-swatch"
                          style={{ background: UNREPRESENTED_TONE }}
                          aria-hidden="true"
                        />
                        + uso sin representación
                      </span>
                    ) : null}
                  </span>
                  {state ? (
                    <span className="system-state formula">
                      uso {formatNumber(state.activity)}
                      {explained && state.shares.length > 0
                        ? ` = ${[
                            ...state.shares.map((share) => formatNumber(share.amount)),
                            ...(state.unrepresentedAmount > 0
                              ? [formatNumber(state.unrepresentedAmount)]
                              : []),
                          ].join(" + ")}`
                        : ""}
                      {state.utilization !== null
                        ? ` · ${formatPercent(state.utilization)}`
                        : ""}
                      {" · "}
                      {state.active ? (
                        <strong className="system-active">activa</strong>
                      ) : (
                        `holgura ${formatNumber(state.slack)}`
                      )}
                      {!state.decompositionMatches ? (
                        <span className="system-warning">
                          {" "}
                          · la suma de a·x no coincide con la actividad de HiGHS
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {definition.products.length > 0 ? (
        <section className="system-group" aria-label="Productos del sistema">
          <h3>Productos</h3>
          <ul>
            {definition.products.map((product) => {
              const state = states.products.get(product.variableId);
              return (
                <li
                  key={product.variableId}
                  data-testid={`scene-product-${product.variableId}`}
                >
                  <button
                    type="button"
                    className="system-entity"
                    aria-pressed={
                      highlight.variableId === product.variableId &&
                      highlight.constraintId === null
                    }
                    {...explore({
                      constraintId: null,
                      variableId: product.variableId,
                    })}
                  >
                    <i
                      className="system-swatch"
                      style={{ background: tones.get(product.variableId) }}
                      aria-hidden="true"
                    />
                    {product.name}
                  </button>
                  <span className="system-fact formula">
                    aporte a Z {formatNumber(product.objectiveCoefficient)} /u
                  </span>
                  {state ? (
                    <span className="system-state formula">
                      cantidad {formatNumber(state.quantity)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
