# Optimization Sandbox

Laboratorio interactivo para construir, resolver y entender modelos de optimización matemática.
La matemática es el núcleo: la interfaz no sustituye al modelo, lo hace visible.

Este repositorio contiene la vertical slice **M1**, el editor matemático interactivo **M2A**, el
constructor de modelos **M2B**, la vista geométrica **M3** y los **templates** con semántica de
escenario de **M4**: el mismo modelo lineal alimenta el editor, la geometría 2D y una solución
explicada por HiGHS.

```text
Interactive Math Editor  →  OptimizationModel  →  FastAPI  →  HiGHS  →  OptimizationResult  →  UI
```

## Estado actual (M1 + M2A + M2B + M3 + M4)

Al abrir la aplicación se elige un **modelo en blanco** o un **template**. El template Product Mix
parte de este modelo, con sus variables llamadas «Producto A» y «Producto B»:

```text
Max Z = 40x₁ + 30x₂

2x₁ +  x₂ ≤ 100   Capacidad de máquina
 x₁ + 2x₂ ≤  80   Mano de obra
 x₁ +  x₂ ≤ 100   Empaque

x₁, x₂ ≥ 0
```

Resultado inicial esperado:

```text
status    = optimal
x₁        = 40
x₂        = 20
objective = 2200

máquina   activity = 100  slack = 0   active = true
mano obra activity =  80  slack = 0   active = true
empaque   activity =  60  slack = 40  active = false
```

El modelo de ejemplo vive en [`templates/product-mix/model.json`](./templates/product-mix/model.json)
y es la única fuente de verdad para inicializar el editor y para los tests del backend. La edición no
modifica el archivo. Su semántica (roles de producto y recurso) está en
[`templates/product-mix/scenario.json`](./templates/product-mix/scenario.json).

### Qué se puede editar

Directamente en la expresión matemática:

- `Max` / `Min`;
- coeficientes de la función objetivo;
- coeficientes de cada restricción;
- operador `≤`, `≥`, `=`;
- lado derecho de cada restricción.

Y desde M2B, la estructura del modelo:

- agregar y eliminar variables (`+ Agregar variable`, `×`);
- agregar y eliminar términos del objetivo y de cada restricción («+ término»);
- agregar y eliminar restricciones (`+ Agregar restricción`, `×`);
- renombrar variables y restricciones inline, manteniendo los `id` internos estables.

Eliminar una variable arrastra sus términos en cascada; una restricción que queda sin términos
desaparece y la UI lo informa con un aviso discreto. Cada cambio actualiza el `OptimizationModel`
en memoria. Si el modelo cambia después de resolver, la solución anterior queda marcada como
obsoleta y se ofrece **Resolver nuevamente**. Cualquier parser de texto sigue fuera del alcance.

Cada operación estructural respeta el contrato: la UI nunca produce un modelo inválido. Eliminar el
último término del objetivo, el último término de una restricción o la única variable del objetivo
está deshabilitado, y el selector «+ término» solo ofrece variables que aún no participan en esa
expresión.

## Stack

- **Frontend:** Next.js 16, React 19, TypeScript, CSS propio.
- **Geometría 2D:** funciones TypeScript puras y SVG nativo, sin dependencias adicionales.
- **Backend:** Python 3.11+, FastAPI, Pydantic, [`highspy`](https://github.com/ERGO-Code/HiGHS) (HiGHS).
- **Sin** base de datos, autenticación, estado en servidor ni parser de texto.

## Estructura

```text
docs/
  MODEL_SPEC.md          contrato canónico del modelo y del resultado
  ARCHITECTURE.md        componentes, fronteras y decisiones
  SCENARIOS.md           templates, ScenarioDefinition y bindings
templates/
  product-mix/
    model.json           modelo de demostración compartido
    scenario.json        semántica del template
solver/
  src/optimization_sandbox/
    schema.py            contrato Pydantic
    validation.py        reglas cruzadas
    highs_solver.py      adaptador HiGHS
    api.py               POST /solve, GET /health
  tests/
web/
  app/                   página y estilos
  components/            editor, vista geométrica, resultados y estado del sandbox
  lib/                   contrato, edición, geometría 2D, números y cliente HTTP
```

## Requisitos

- Node.js >= 20.9 (probado con Node 24)
- npm
- Python >= 3.11 (probado con Python 3.13)

## Desarrollo local

Se necesitan dos terminales. El backend debe estar en marcha para resolver.

### 1. Backend

```powershell
cd solver
python -m venv .venv

# Windows (PowerShell)
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

python -m pip install -e ".[dev]"
uvicorn optimization_sandbox.api:app --reload --port 8000
```

Comprobación:

```powershell
curl.exe http://127.0.0.1:8000/health
# {"status":"ok"}
```

Documentación interactiva de la API: <http://127.0.0.1:8000/docs>.

### 2. Frontend

```powershell
cd web
npm install
npm run dev
```

Abrir <http://localhost:3000>, editar los valores de la expresión y pulsar **Resolver modelo**.

El frontend llama por defecto a `http://127.0.0.1:8000`. Para usar otra URL:

```powershell
$env:NEXT_PUBLIC_SOLVER_URL = "http://127.0.0.1:9000"
npm run dev
```

En el backend, los orígenes CORS permitidos se configuran con `CORS_ORIGINS` (lista separada por
comas; por defecto `http://localhost:3000,http://127.0.0.1:3000`).

## API

`POST /solve` recibe directamente un `OptimizationModel`. Desde la raíz del repositorio:

```powershell
curl.exe -X POST http://127.0.0.1:8000/solve `
  -H "Content-Type: application/json" `
  --data "@templates/product-mix/model.json"
```

Devuelve un `OptimizationResult`:

```json
{
  "status": "optimal",
  "objectiveValue": 2200,
  "variableValues": [
    { "variableId": "x1", "value": 40 },
    { "variableId": "x2", "value": 20 }
  ],
  "constraints": [
    { "constraintId": "machine", "activity": 100, "rhs": 100, "slack": 0, "active": true },
    { "constraintId": "labor", "activity": 80, "rhs": 80, "slack": 0, "active": true },
    { "constraintId": "packaging", "activity": 60, "rhs": 100, "slack": 40, "active": false }
  ],
  "message": null
}
```

Estados posibles: `optimal`, `infeasible`, `unbounded`, `error`. Un modelo inválido devuelve `422`
con un sobre de error estructurado. El contrato completo está en
[`docs/MODEL_SPEC.md`](./docs/MODEL_SPEC.md).

## Tests y build

```powershell
cd solver
.\.venv\Scripts\python.exe -m pytest

cd ..\web
npm test
npm run build
```

`npm test` ejecuta Vitest y Testing Library para el editor, la vista geométrica y los escenarios, más
los tests puros de geometría 2D. Verificado en M4: 24 tests de backend y 117 de frontend.

## Alcance actual

Incluido en M1 + M2A + M2B + M3 + M4:

- contrato canónico para LP continuos;
- validación del modelo;
- resolución real con HiGHS;
- estados del solver y holguras;
- editor matemático inline del sentido, coeficientes, operadores y RHS;
- constructor de modelos: agregar y eliminar variables, términos y restricciones, y renombrarlos;
- cascada visible al eliminar variables que dejan restricciones vacías;
- resultado obsoleto explícito tras editar;
- vista geométrica para exactamente dos variables: fronteras, semiplanos explorables, región
  factible con bounds, óptimo vigente y restricciones activas;
- estados geométricos para regiones vacías, infinitas y dimensiones no soportadas;
- hover/foco entre editor y geometría, con layout responsive Modelo | Vista geométrica;
- modelo en blanco y template Product Mix, con roles semánticos visibles y separados del modelo.

Todavía **no** incluido:

- parser de texto libre;
- vista geométrica 3D ni Scenario View;
- editor de bindings, persistencia, cuentas o colaboración;
- variables enteras, MILP o modelos no lineales.

La hoja de ruta y los principios del producto están en [`VISION.md`](./VISION.md) y
[`MVP.md`](./MVP.md).

## Documentación

- [`docs/MODEL_SPEC.md`](./docs/MODEL_SPEC.md) — representación canónica y contrato HTTP.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — arquitectura, decisiones y límites actuales.
- [`docs/CURRENT_STATE.md`](./docs/CURRENT_STATE.md) — estado del proyecto para continuarlo.
- [`docs/GEOMETRY.md`](./docs/GEOMETRY.md) — M3, algoritmo 2D, viewport, tolerancias y validación.
- [`docs/SCENARIOS.md`](./docs/SCENARIOS.md) — M4, templates, ScenarioDefinition y bindings.
