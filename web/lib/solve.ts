import type { OptimizationModel, OptimizationResult } from "./model";

const SOLVER_URL = (
  process.env.NEXT_PUBLIC_SOLVER_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export interface SolveIssue {
  path: string;
  message: string;
}

interface ApiErrorBody {
  error?: {
    message?: string;
    issues?: SolveIssue[];
  };
}

export class SolveRequestError extends Error {
  readonly issues: SolveIssue[];

  constructor(message: string, issues: SolveIssue[] = []) {
    super(message);
    this.name = "SolveRequestError";
    this.issues = issues;
  }
}

export async function solveModel(
  model: OptimizationModel,
): Promise<OptimizationResult> {
  let response: Response;

  try {
    response = await fetch(`${SOLVER_URL}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(model),
    });
  } catch {
    throw new SolveRequestError(
      "No se pudo conectar con el solver. Comprueba que el servicio de Python esté en marcha.",
    );
  }

  if (!response.ok) {
    const body = await readErrorBody(response);

    if (response.status === 422) {
      throw new SolveRequestError(
        "El modelo no es válido. Revisa los datos enviados.",
        body?.error?.issues ?? [],
      );
    }

    throw new SolveRequestError(
      `El solver respondió con un error (HTTP ${response.status}).`,
    );
  }

  try {
    return (await response.json()) as OptimizationResult;
  } catch {
    throw new SolveRequestError("El solver devolvió una respuesta ilegible.");
  }
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}
