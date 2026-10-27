import { formatNumber } from "@/lib/format";
import type {
  OptimizationModel,
  OptimizationResult,
  SolveStatus,
} from "@/lib/model";
import type { SolveIssue } from "@/lib/solve";

const STATUS_COPY: Record<
  Exclude<SolveStatus, "optimal">,
  { title: string; description: string }
> = {
  infeasible: {
    title: "Modelo infactible",
    description:
      "Ningún punto satisface todas las restricciones al mismo tiempo. El sistema no tiene solución factible.",
  },
  unbounded: {
    title: "Modelo no acotado",
    description:
      "La función objetivo puede mejorar de forma indefinida sin abandonar la región factible.",
  },
  error: {
    title: "Error del solver",
    description:
      "HiGHS no pudo completar la resolución con un resultado concluyente.",
  },
};

interface RequestError {
  message: string;
  issues: SolveIssue[];
}

interface ResultsPanelProps {
  model: OptimizationModel;
  result: OptimizationResult | null;
  error: RequestError | null;
  isSolving: boolean;
  isStale: boolean;
  onResolve: () => void;
}

export function ResultsPanel({
  model,
  result,
  error,
  isSolving,
  isStale,
  onResolve,
}: ResultsPanelProps) {
  return (
    <section aria-labelledby="results-heading">
      <div className="section-heading">
        <span className="section-index">03</span>
        <h2 id="results-heading">Resultado</h2>
      </div>

      {isStale ? (
        <div className="stale-notice">
          <p>El modelo cambió desde la última resolución.</p>
          <button type="button" className="text-button" onClick={onResolve}>
            Resolver nuevamente
          </button>
        </div>
      ) : null}

      {isSolving ? (
        <p className="empty-state" role="status">
          Resolviendo el modelo con HiGHS…
        </p>
      ) : error ? (
        <RequestErrorBlock error={error} />
      ) : result ? (
        <ResultBody model={model} result={result} isStale={isStale} />
      ) : (
        <p className="empty-state">
          Pulsa «Resolver modelo» para calcular la solución.
        </p>
      )}
    </section>
  );
}

function ResultBody({
  model,
  result,
  isStale,
}: {
  model: OptimizationModel;
  result: OptimizationResult;
  isStale: boolean;
}) {
  if (result.status !== "optimal") {
    const copy = STATUS_COPY[result.status];
    return (
      <div className="status-block">
        <p className={`status-line status-line-${result.status}`}>
          <span className="status-dot" />
          {copy.title}
        </p>
        <p className="status-description">{copy.description}</p>
        {result.message ? (
          <p className="technical-note">{result.message}</p>
        ) : null}
      </div>
    );
  }

  const variableNames = new Map(
    model.variables.map((variable) => [variable.id, variable.name]),
  );
  const constraintNames = new Map(
    model.constraints.map((constraint) => [constraint.id, constraint.name]),
  );
  const activeCount = result.constraints.filter(
    (constraint) => constraint.active,
  ).length;

  return (
    <>
      <div className="solution-summary">
        <div>
          <p className="status-line status-line-optimal">
            <span className="status-dot" />
            {isStale ? "Solución anterior" : "Solución óptima"}
          </p>
          <p className="solution-caption">
            {isStale
              ? "Valores de decisión que optimizaban el modelo anterior."
              : "Valores de decisión que optimizan la función objetivo."}
          </p>
        </div>
        <div className="objective-total">
          <span className="objective-label">
            {isStale ? "Valor anterior" : "Valor óptimo"}
          </span>
          <span className="objective-value formula">
            Z ={" "}
            {result.objectiveValue === null
              ? "—"
              : formatNumber(result.objectiveValue)}
          </span>
        </div>
      </div>

      <dl className="variables">
        {result.variableValues.map((item) => (
          <div className="variable-row" key={item.variableId}>
            <dt className="variable-name formula">
              {variableNames.get(item.variableId) ?? item.variableId}
            </dt>
            <dd className="variable-value formula">
              {formatNumber(item.value)}
            </dd>
          </div>
        ))}
      </dl>

      {result.constraints.length > 0 ? (
        <>
          <div className="constraints-heading">
            <h3>Restricciones</h3>
            <span className="constraints-count">
              {activeCount} de {result.constraints.length} activas
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">
                Uso, límite, holgura y estado de cada restricción
              </caption>
              <thead>
                <tr>
                  <th scope="col">Restricción</th>
                  <th scope="col" className="numeric">
                    Uso
                  </th>
                  <th scope="col" className="numeric">
                    Límite
                  </th>
                  <th scope="col" className="numeric">
                    Holgura
                  </th>
                  <th scope="col" className="table-end">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.constraints.map((constraint) => (
                  <tr key={constraint.constraintId}>
                    <td>
                      {constraintNames.get(constraint.constraintId) ??
                        constraint.constraintId}
                    </td>
                    <td className="numeric formula" data-label="Uso">
                      {formatNumber(constraint.activity)}
                    </td>
                    <td className="numeric formula" data-label="Límite">
                      {formatNumber(constraint.rhs)}
                    </td>
                    <td className="numeric formula" data-label="Holgura">
                      {formatNumber(constraint.slack)}
                    </td>
                    <td className="table-end" data-label="Estado">
                      <span
                        className={
                          constraint.active
                            ? "constraint-status constraint-status-active"
                            : "constraint-status"
                        }
                      >
                        {constraint.active ? "Activa" : "Inactiva"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <p className="solver-note">
        {isStale
          ? "Resultado obtenido con HiGHS para el modelo anterior."
          : "Resuelto con HiGHS."}
      </p>
    </>
  );
}

function RequestErrorBlock({ error }: { error: RequestError }) {
  return (
    <div className="error-block" role="alert">
      <p className="status-line status-line-error">
        <span className="status-dot" />
        No se pudo resolver
      </p>
      <p className="status-description">{error.message}</p>
      {error.issues.length > 0 ? (
        <ul className="issue-list">
          {error.issues.map((issue) => (
            <li key={`${issue.path}-${issue.message}`}>
              <code>{issue.path}</code>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
