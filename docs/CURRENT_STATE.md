# CURRENT_STATE — Optimization Sandbox

**Última actualización:** 2026-10-27
**Estado:** M1, M2A, M2B, M3 y M4 completados y verificados.
**Propósito de este documento:** dar a un agente nuevo el contexto mínimo para continuar el proyecto leyendo el repositorio, sin sustituir a la documentación de referencia.

---

## 1. Visión actual del producto

Optimization Sandbox es un laboratorio interactivo de optimización matemática. La matemática es el
núcleo y la interfaz debe hacerla visible y manipulable, no ocultarla detrás de un formulario o de un
dashboard.

El principio de producto es una cadena única y explícita:

```text
modelo estructurado → OptimizationModel → solver → OptimizationResult → interfaz
```

La visión completa está en [`VISION.md`](../VISION.md); el alcance original del MVP, en
[`MVP.md`](../MVP.md). Las decisiones de producto y arquitectura están en
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 2. Milestones completados

| Milestone | Estado | Contenido |
| --------- | ------ | --------- |
| **M1** | Completado | Pipeline vertical: contrato canónico, FastAPI, HiGHS, resultado estructurado y UI de resultados. |
| **M2A** | Completado | Editor matemático inline del modelo existente: sentido, coeficientes, operadores y RHS. |
| **M2B** | Completado | Model Builder: agregar y eliminar variables, términos y restricciones; renombrado inline. |
| **M3** | Completado | Motor geométrico 2D, renderer SVG, óptimo vigente, exploración por ID y layout de sandbox. |
| **M4** | Completado | Templates como datos, modelo en blanco, `ScenarioDefinition` separado del modelo y roles semánticos visibles. |

No hay milestones posteriores a M4 implementados. El detalle de M3 está en la sección 21 y en
[`GEOMETRY.md`](./GEOMETRY.md); el de M4, en la sección 22 y en [`SCENARIOS.md`](./SCENARIOS.md).

---

## 3. Estado de M1

M1 resolvió el primer corte vertical completo:

- `templates/product-mix/model.json` como modelo de demostración (movido desde `examples/` en M4).
- Validación estructural con Pydantic y reglas cruzadas en Python.
- Resolución real con HiGHS mediante `highspy`.
- Estados públicos: `optimal`, `infeasible`, `unbounded`, `error`.
- Cálculo de `activity`, `rhs`, `slack` y `active` en el backend.
- UI mínima para mostrar solución, valores de variables y tabla de restricciones.
- Manejo de errores `422` del modelo y fallos de resolución.

El resultado esperado del modelo original es:

```text
x₁ = 40
x₂ = 20
Z  = 2200

Capacidad de máquina   100 / 100   holgura 0    ACTIVA
Mano de obra            80 /  80   holgura 0    ACTIVA
Empaque                 60 / 100   holgura 40   INACTIVA
```

La interpretación de las erratas de `MVP.md` (`=` en restricciones y cotas escritas como `x1 = 0`)
está documentada en `ARCHITECTURE.md`, decisión **D7**.

---

## 4. Estado de M2A

Sobre el modelo existente, el usuario puede editar directamente en la expresión:

- `Max` / `Min`;
- coeficientes de la función objetivo;
- coeficientes de cada restricción;
- operador `≤`, `≥`, `=`;
- lado derecho (RHS) de cada restricción.

La estructura del modelo (crear o eliminar variables, términos y restricciones) pertenece a M2B.

El estado inicial se copia de `templates/product-mix/model.json`; el archivo no se modifica al editar. El
modelo editable vive únicamente en el estado React como `OptimizationModel`.

---

## 5. Estado de M2B

El editor es ahora un constructor de modelos. Desde la propia expresión matemática el usuario puede:

- **agregar variables** («+ Agregar variable»): nacen continuas, no negativas, sin términos, con
  `id` autogenerado (`x3`, `x4`…) y nombre `x₃`, `x₄`…; aparecen en la línea Dominio y en los
  selectores «+ término» de cada expresión;
- **eliminar variables** (`×` en la línea Dominio): la eliminación es una **cascada**: sus términos
  desaparecen del objetivo y de todas las restricciones, y una restricción que queda sin términos se
  elimina con un aviso visible («Se eliminó 1 restricción que quedó vacía.»);
- **renombrar variables y restricciones inline**: el `name` es editable y el `id` interno queda
  estable;
- **agregar términos** («+ término»): un selector integrado al final de la expresión ofrece solo las
  variables que aún no participan en ella; el término nace con coeficiente `1` y su variable queda
  fija (cambiarla es eliminarlo y agregar otro);
- **eliminar términos** (`×` junto a cada término);
- **agregar restricciones** («+ Agregar restricción»): nacen sembradas como `1·x₁ ≤ 0` con etiqueta
  `Restricción N` porque el contrato exige al menos un término por restricción;
- **eliminar restricciones** (`×` al final de cada fórmula).

El modelo en estado es siempre válido: las eliminaciones que el contrato no permite (último término
del objetivo, último término de una restricción, única variable del modelo o del objetivo) están
deshabilitadas con su motivo, y las operaciones de agregación ignoran duplicados. Un no-op devuelve
el mismo objeto, así que no marca la solución como obsoleta.

Todo sigue siendo edición directa del `OptimizationModel`: sin parser, sin representación textual
paralela y sin cambios en el backend.

---

## 6. Arquitectura actual

```text
┌─────────────────────────────────────┐
│ web/                                │
│ Next.js 16 + React 19 + TypeScript  │
│                                     │
│ estado: OptimizationModel           │
│ editor inline                       │
│ panel de resultados                 │
└──────────────────┬──────────────────┘
                   │ HTTP/JSON
                   │ POST /solve
                   ▼
┌─────────────────────────────────────┐
│ solver/                             │
│ FastAPI + Pydantic + highspy/HiGHS  │
│                                     │
│ api.py          rutas HTTP          │
│ validation.py   reglas cruzadas     │
│ highs_solver.py adaptador HiGHS     │
│ schema.py       contrato            │
└─────────────────────────────────────┘
```

- **Sin** base de datos, autenticación, sesiones, caché ni estado entre peticiones.
- **Sin** parser de modelos.
- **Sin** lógica del solver en el frontend.
- **Sin** lógica de presentación en el backend.

La explicación completa de componentes y decisiones está en
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 7. Flujo de datos

1. `Sandbox` muestra el selector «Nuevo modelo» hasta que el usuario elige **En blanco**
   (`web/lib/blank-model.ts`) o un template de `web/lib/templates.ts`, que importa
   `templates/<id>/model.json` y `scenario.json`.
2. El modelo elegido se clona con `structuredClone`. El escenario, si existe, se guarda aparte en el
   mismo `workspace`; nunca dentro del modelo.
3. Cada edición aplica una función pura de `web/lib/model-editing.ts` y produce un nuevo
   `OptimizationModel`. Tras cada cambio, `pruneScenario` elimina los bindings de entidades que ya no
   existen.
4. Al resolver, `Sandbox` toma una instantánea del modelo actual y llama a `POST /solve` con el
   modelo, nunca con el escenario.
5. FastAPI valida la forma con Pydantic y las reglas cruzadas con `validation.py`.
6. El adaptador construye el problema HiGHS y lo resuelve.
7. El backend devuelve un `OptimizationResult` con `200`, o `422` si el modelo es inválido.
8. La UI muestra el resultado usando el modelo con el que se resolvió.
9. Si el modelo cambia después, el resultado queda marcado como obsoleto. Si se elige otro modelo,
   una respuesta tardía del solver se descarta.

Desde M3, el modelo vigente también alimenta `lib/geometry.ts` → `GeometricView`. El resultado
vigente aporta únicamente el óptimo y las restricciones activas. Editar oculta el punto anterior;
la geometría se actualiza sin esperar una nueva resolución.

---

## 8. Archivos y módulos importantes

```text
/
├── VISION.md                         visión del producto
├── MVP.md                            alcance original del MVP (contiene erratas conocidas)
├── README.md                         arranque, stack y alcance actual
├── docs/
│   ├── CURRENT_STATE.md              este documento
│   ├── MODEL_SPEC.md                 contrato canónico (autoritativo)
│   ├── ARCHITECTURE.md               arquitectura y decisiones
│   ├── GEOMETRY.md                   M3: geometría 2D
│   └── SCENARIOS.md                  M4: templates y ScenarioDefinition
├── templates/
│   └── product-mix/
│       ├── model.json                modelo de demostración compartido
│       └── scenario.json             semántica de Product Mix
├── solver/
│   ├── pyproject.toml
│   ├── src/optimization_sandbox/
│   │   ├── schema.py                 modelos Pydantic del contrato
│   │   ├── validation.py             unicidad, referencias, cotas, términos
│   │   ├── highs_solver.py           adaptador HiGHS, estados, slack y active
│   │   └── api.py                    POST /solve, GET /health, CORS, 422
│   └── tests/                        pytest
└── web/
    ├── app/
    │   ├── layout.tsx                layout raíz
    │   ├── page.tsx                  página única
    │   └── globals.css               estética editorial y estilos del editor
    ├── components/
    │   ├── sandbox.tsx               estado del modelo, resolución, staleness
    │   ├── geometric-view.tsx        renderer SVG y exploración de geometría 2D
    │   ├── model-editor.tsx          expresión editable y constructor del modelo
    │   ├── math-number-input.tsx     campo numérico inline con borrador transitorio
    │   ├── math-text-input.tsx       campo de texto inline con borrador transitorio (nombres)
    │   └── results-panel.tsx         resultado, tabla, errores y aviso obsoleto
    ├── lib/
    │   ├── model.ts                  tipos TypeScript del contrato
    │   ├── geometry.ts               geometría 2D pura derivada del modelo
    │   ├── blank-model.ts            modelo en blanco (M4)
    │   ├── scenario.ts               ScenarioDefinition, roles y poda de bindings (M4)
    │   ├── templates.ts              registro de templates (M4)
    │   ├── model-editing.ts          actualizaciones puras e inmutables (M2A + M2B)
    │   ├── number-input.ts           parseo/formato de números editables
    │   ├── format.ts                 formato de resultados
    │   └── solve.ts                  cliente HTTP de /solve
    ├── next.config.ts                Turbopack root en la raíz del repo
    ├── vitest.config.mts             configuración de tests
    └── vitest.setup.ts               jest-dom y cleanup
```

Tests:

- `solver/tests/test_highs_solver.py`
- `solver/tests/test_validation.py`
- `solver/tests/test_api.py`
- `web/lib/number-input.test.ts`
- `web/lib/model-editing.test.ts`
- `web/components/sandbox.test.tsx`
- `web/lib/geometry.test.ts`
- `web/components/geometric-view.test.tsx`

---

## 9. Contrato `OptimizationModel`

La fuente autoritativa es [`MODEL_SPEC.md`](./MODEL_SPEC.md). Resumen:

```ts
interface OptimizationModel {
  variables: {
    id: string;
    name: string;
    type: "continuous";
    lowerBound: number | null;
    upperBound: number | null;
  }[];
  objective: {
    sense: "maximize" | "minimize";
    terms: { variableId: string; coefficient: number }[];
  };
  constraints: {
    id: string;
    name: string;
    terms: { variableId: string; coefficient: number }[];
    operator: "<=" | ">=" | "=";
    rhs: number;
  }[];
}
```

Reglas principales:

- al menos una variable y al menos un término objetivo;
- `id` de variables y de restricciones únicos y no vacíos;
- todo `variableId` debe existir;
- una variable aparece como máximo una vez por lista de términos;
- números finitos;
- `lowerBound <= upperBound` cuando ambas cotas existen;
- las cotas viven en la variable, no como restricciones;
- se conserva el orden de variables, términos y restricciones.

La no negatividad del ejemplo se expresa con `lowerBound: 0`. La UI muestra `<=`, `>=`, `=` como
`≤`, `≥`, `=`.

---

## 10. Contrato `OptimizationResult`

```ts
interface OptimizationResult {
  status: "optimal" | "infeasible" | "unbounded" | "error";
  objectiveValue: number | null;
  variableValues: { variableId: string; value: number }[];
  constraints: {
    constraintId: string;
    activity: number;
    rhs: number;
    slack: number;
    active: boolean;
  }[];
  message: string | null;
}
```

Invariantes:

| Estado | `objectiveValue` | `variableValues` | `constraints` | `message` |
| ------ | ---------------- | ---------------- | ------------- | --------- |
| `optimal` | número | todas, en orden | todas, en orden | `null` |
| `infeasible` | `null` | `[]` | `[]` | `null` |
| `unbounded` | `null` | `[]` | `[]` | `null` |
| `error` | `null` | `[]` | `[]` | string |

La holgura se calcula una sola vez en el backend:

- `<=`: `slack = rhs − activity`
- `>=`: `slack = activity − rhs`
- `=`: `slack = 0`

`active` usa una tolerancia relativa de `1e-7 · max(1, |rhs|, |activity|)`. En estados no óptimos no
se inventan valores parciales. Los detalles de estados y errores están en `MODEL_SPEC.md`.

---

## 11. Modelo Product Mix de demostración

Vive en [`templates/product-mix/model.json`](../templates/product-mix/model.json) y es la única fuente
de verdad para inicializar el editor (a través de `web/lib/templates.ts`) y para los tests del
backend. La edición no modifica el archivo. Desde M4, `x1` y `x2` se llaman «Producto A» y «Producto B»
en el modelo; sus roles semánticos están en `templates/product-mix/scenario.json` (ver
[`SCENARIOS.md`](./SCENARIOS.md)).

```text
Max Z = 40·Producto A + 30·Producto B      (x₁ = Producto A, x₂ = Producto B)

2x₁ +  x₂ ≤ 100   Capacidad de máquina
 x₁ + 2x₂ ≤  80   Mano de obra
 x₁ +  x₂ ≤ 100   Empaque

x₁, x₂ ≥ 0
```

La tercera restricción (`Empaque`) es deliberadamente no activa: permite demostrar la diferencia
entre una restricción activa y otra con holgura sin alterar el óptimo.

Resultado óptimo:

```text
x₁ = 40
x₂ = 20
Z  = 2200

machine    activity 100  rhs 100  slack 0   active true
labor      activity  80  rhs  80  slack 0   active true
packaging  activity  60  rhs 100  slack 40  active false
```

---

## 12. Comportamiento del editor matemático

- La expresión es la interfaz: los valores editables están integrados en la propia fórmula.
- `ModelEditor` renderiza el objetivo y las restricciones como expresiones, no como un formulario.
- `MathNumberInput` mantiene un borrador de texto local y transitorio:
  - acepta negativos, cero, decimales con coma o punto;
  - solo confirma al modelo números finitos;
  - `""`, `"-"` o `"2,"` no se convierten en `0`;
  - al perder el foco, vuelve a mostrar el último valor confirmado.
- El sentido y el operador se eligen con selectores nativos estilizados inline.
- `MathTextInput` mantiene un borrador transitorio para los nombres: confirma texto no vacío,
  conserva el último nombre válido si se borra y lo restaura al perder el foco.
- Las operaciones estructurales y el renombrado se integran en la expresión y la línea Dominio,
  conservando los IDs internos y los guardas del contrato descritos en la sección 5.
- Cada cambio efectivo produce un `OptimizationModel` nuevo mediante funciones puras e inmutables.
  Una operación estructural rechazada o un renombrado sin cambios conserva la misma referencia.
- No existe una representación textual paralela del modelo ni un parser de expresiones.
- El editor conserva la validez del modelo: no permite introducir IDs duplicados, referencias
  desconocidas, expresiones sin términos, nombres en blanco ni cotas incoherentes.
- En móvil, las restricciones se apilan y la tabla de resultados pasa a un formato de etiqueta/valor.

Decisiones visuales: composición editorial, fondo papel, tipografía monoespaciada para la
matemática, líneas finas, espacio negativo y controles sin tarjetas, sombras ni gradientes. Se
conserva la estética de M1.

---

## 13. Manejo del resultado obsoleto

El estado de la última resolución (`SolveOutcome`) guarda:

```ts
{
  kind: "result" | "error";
  model: OptimizationModel;  // instantánea del modelo usado
  result | error;
}
```

- `isStale` se calcula comparando por identidad la instantánea con el modelo actual.
- Toda edición efectiva, numérica o estructural (incluido el renombrado), crea un objeto nuevo,
  por lo que el resultado anterior pasa a obsoleto. Un no-op estructural conserva la referencia.
- Si la resolución estaba en curso y el usuario editó, la respuesta se asocia a la instantánea
  capturada y también queda marcada como obsoleta.
- El resultado antiguo no se oculta, pero se etiqueta como **«Solución anterior»** / **«Valor
  anterior»** y aparece el aviso:

```text
El modelo cambió desde la última resolución.   [Resolver nuevamente]
```

- Al editar después de un error, el error se descarta porque describe un modelo que ya no existe.
- La acción **Resolver nuevamente** reutiliza el mismo flujo de resolución; no hay lógica duplicada.

---

## 14. Decisiones UX importantes

1. **La matemática es la interfaz.** Nada de formularios con etiquetas del tipo
   «Coeficiente / Variable / Operador».
2. **Edición inline.** Inputs con subrayado discontinuo y selectores integrados en la expresión.
3. **Un solo modelo.** El estado canónico es la única fuente de verdad; el texto de un campo es
   solo un borrador transitorio.
4. **Nunca convertir un campo vacío en cero.** El valor anterior se conserva hasta que el texto sea
   un número completo o el campo pierda el foco.
5. **Resultado obsoleto explícito.** Una solución antigua nunca se presenta como si correspondiera
   al modelo actual.
6. **Validación preventiva.** La UI solo permite estados válidos; los errores del backend siguen
   mostrándose con sus `issues`.
7. **Errores técnicos en inglés, interfaz en español.** El backend devuelve mensajes técnicos; la UI
   los presenta dentro de su propio texto.
8. **Sin controles falsos ni decoración SaaS.** Solo existen las acciones que funcionan.
9. **Documentación en español, código/API en inglés.**

---

## 15. Tests existentes

### Backend — 24 tests

- solución óptima del Product Mix y holguras;
- modelo de tres variables: `x₁ = 0`, `x₂ = 100`, `x₃ = 80/3`, `Z = 2560/3`;
- minimización y restricción `>=`;
- igualdad;
- cotas de variable;
- infactible y no acotado;
- mapeo de estados de HiGHS, incluidos estados ambiguos → `error`;
- fallo inesperado del solver;
- validación: referencias desconocidas, IDs duplicados, términos duplicados, cotas incoherentes,
  nombres vacíos;
- API: `/health`, `/solve` correcto y `422` estructurado;
- API: un campo `scenario` se rechaza con `422` (la semántica no llega al solver);
- API: un LP sin restricciones (modelo en blanco) se resuelve y da `unbounded`.

### Frontend — 117 tests


- parseo y formato de números editables (coma, punto, exponente, incompletos);
- actualizaciones puras del modelo (sentido, coeficientes, operador, RHS, inmutabilidad);
- integración del editor: modelo inicial, payload enviado, restricción correcta, resolución con el
  modelo vigente, resultado obsoleto, campo vacío, negativos y decimales;
- operaciones estructurales: agregar y eliminar variables, términos y restricciones, IDs
  autogenerados, cascada y avisos singular/plural;
- renombrado inline de variables y restricciones sin alterar sus IDs ni referencias, y rechazo
  de nombres vacíos;
- guardas del último término de cada expresión y de la única variable del objetivo, y selectores
  de términos limitados a variables disponibles;
- resultado obsoleto tras una edición estructural;
- geometría 2D: intersecciones, verticales/horizontales, signos, bounds, redundancia, IDs,
  infactibilidad, regiones infinitas, igualdades, segmentos/puntos, escalas y viewport;
- integración geométrica: edición inmediata, óptimo vigente, obsolescencia numérica y estructural,
  respuesta tardía del solver, dimensiones no soportadas, hover/foco e hidratación SSR.
- M4, lógica de escenario: poda de bindings, ids reutilizados, renombrado, orden de arrays,
  referencias ausentes sin error, integridad del template Product Mix y modelo en blanco.
- M4, interfaz: selector inicial, modelo en blanco, Product Mix con roles visibles, renombrado sin
  pérdida de rol, eliminación y reutilización de ids, payload exacto a `/solve`, cambio y cancelación
  de modelo, y descarte de respuestas tardías de un modelo anterior.

### Verificación E2E

En la verificación manual previa de M2A, con Playwright contra FastAPI + HiGHS reales:

- modelo original → `40 / 20 / 2200`;
- editado `40 → 50` y `100 → 120` → `53,3333 / 13,3333 / 3066,6667`;
- operador de Empaque `≤ → ≥` → `infeasible`, confirmando que el cambio llegó a HiGHS;
- aviso de resultado obsoleto tras editar.

En la verificación manual previa de M2B, con Chrome y el backend real, se construyó desde la UI:

```text
Max Z = 5x₁ + 8x₂ + 2x₃
2x₁ + x₂ ≤ 100
x₁ + 3x₃ ≤ 80
x₁, x₂, x₃ ≥ 0
```

Se obtuvo `x₁ = 0`, `x₂ = 100`, `x₃ = 26,6667`, `Z = 853,3333`. También se verificaron el
aviso obsoleto, la cascada al eliminar una variable y el renombrado inline.

Playwright no forma parte de la suite versionada; la suite del repositorio es pytest + Vitest.

M3 también se verificó con Chromium y FastAPI + HiGHS reales: Product Mix → `(40, 20)`; RHS de
máquina `100 → 120` → `(53,3333; 13,3333)`, `Z = 2533,3333`; frontera vertical; coeficientes
negativos; estados infactible y no acotado. Se revisaron escritorio y móvil de 390 px. Pasos y
limitaciones en [`GEOMETRY.md`](./GEOMETRY.md).

---

## 16. Cómo levantar frontend y backend

Se necesitan dos terminales.

### Backend

```powershell
cd "C:\Users\Bulla\OneDrive\Desktop\Projects\Sandbox Optri\solver"
.\.venv\Scripts\python.exe -m uvicorn optimization_sandbox.api:app --reload --port 8000
```

Si se parte de una copia limpia:

```powershell
cd solver
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

La forma anterior evita depender de que `uvicorn` esté en el `PATH` tras activar el entorno. En CMD
también funciona; en PowerShell, `Activate.ps1` puede requerir ajustar la política de ejecución.

Comprobación:

```powershell
curl.exe http://127.0.0.1:8000/health
# {"status":"ok"}
```

Documentación de la API: <http://127.0.0.1:8000/docs>.

### Frontend

```powershell
cd "C:\Users\Bulla\OneDrive\Desktop\Projects\Sandbox Optri\web"
npm install
npm run dev
```

Abrir <http://localhost:3000>. El frontend apunta por defecto a `http://127.0.0.1:8000`; se puede
cambiar con `NEXT_PUBLIC_SOLVER_URL`. Los orígenes CORS del backend se configuran con
`CORS_ORIGINS`.

---

## 17. Comandos de tests y build

```powershell
# Backend
cd solver
.\.venv\Scripts\python.exe -m pytest

# Frontend
cd ..\web
npm test
npm run build
```

Estado verificado en la última ejecución:

- backend: **24 passed**;
- frontend: **117 passed**;
- `npm run build`: correcto.

---

## 18. Funcionalidades explícitamente fuera de alcance

- Parser de texto libre o sintaxis tipo AMPL.
- Vista geométrica 3D, Three.js, zoom/pan avanzado y animación de la función objetivo.
- Persistencia, historial, undo/redo, editor de bindings y Scenario View (3D).
- Autenticación, base de datos, colaboración o IA.
- Variables enteras, binarias, MILP, optimización no lineal o multiobjetivo.
- Cambios de arquitectura que introduzcan una representación paralela del modelo.

Cualquier extensión debe actualizar `MODEL_SPEC.md` y conservar el contrato canónico.

---

## 19. Referencias

- [`VISION.md`](../VISION.md) — principios y dirección del producto.
- [`MVP.md`](../MVP.md) — alcance original; contiene erratas conocidas.
- [`README.md`](../README.md) — arranque y resumen del estado actual.
- [`MODEL_SPEC.md`](./MODEL_SPEC.md) — contrato autoritativo de modelo y resultado.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — componentes, flujo y decisiones (D1–D11).
- [`GEOMETRY.md`](./GEOMETRY.md) — M3, algoritmo, precisión, viewport y validación.
- [`SCENARIOS.md`](./SCENARIOS.md) — M4, ScenarioDefinition, bindings, lifecycle y templates.

---

## 20. Cierre de M2B

**M2B — Model Builder completado.**

El editor permite:

- agregar y eliminar variables;
- agregar y eliminar términos de la función objetivo y de las restricciones;
- agregar y eliminar restricciones;
- renombrar variables y restricciones inline;
- mantener `OptimizationModel` como única fuente de verdad, sin parser ni representación textual
  paralela.

Se conservan el contrato de M1, el adaptador HiGHS, el manejo de resultado obsoleto y la edición
numérica inline. M3 extiende esta base con la vista geométrica descrita a continuación.

---

## 21. Estado de M3 y camino posterior

**M3 completado**, con tres responsabilidades separadas:

- **M3A:** `web/lib/geometry.ts` calcula fronteras con `constraintId`, semiplanos, bounds,
  intersección factible y viewport. Clasifica la región antes del recorte; incluye regiones
  infinitas, igualdades, segmentos y puntos. Nunca calcula el óptimo.
- **M3B:** `GeometricView` usa SVG nativo sin dependencias nuevas. Dibuja ejes, región rayada,
  fronteras, restricciones activas y óptimo exclusivamente del resultado vigente de HiGHS.
  Hover/foco enlaza editor y líneas; la leyenda permite explorar semiplanos y bounds.
- **M3C:** modelo y geometría en columnas; resultados debajo. Hasta 980 px se apilan.

La geometría requiere exactamente dos variables. Otras dimensiones muestran información y
permiten seguir editando/resolviendo. Una escala numérica no representable muestra una limitación
explícita. La región no acotada se distingue del estado `unbounded` del objetivo: la autoridad
sobre la resolución sigue siendo HiGHS. Los datos geométricos son derivados, sin estado matemático
editable adicional ni cambios en el backend o el contrato canónico.

Al editar, el óptimo anterior se oculta y deja de influir en el viewport; el panel de resultados
conserva el aviso obsoleto de M2. Las respuestas tardías permanecen asociadas a su instantánea.

El camino posterior contempla plantillas y metadatos semánticos y otros tipos de variables y
modelos previa extensión de `MODEL_SPEC.md`. No hay infraestructura adicional para estas etapas.

---

## 22. Estado de M4 — Templates y semántica de escenario

**M4 completado.** Distingue un modelo genérico (Blank Model) de un modelo que representa un problema
conocido (Template), sin tocar `OptimizationModel` ni el contrato HTTP.

- **Selector inicial:** «Nuevo modelo» ofrece «En blanco» y los templates. Desde un modelo activo,
  el botón «Nuevo modelo» abre el mismo selector; «Cancelar» conserva el trabajo.
- **Blank Model:** `Max Z = x₁ + x₂`, `x₁, x₂ ≥ 0`, sin restricciones. Sin semántica. La Geometric
  View y el solver funcionan desde el inicio.
- **Product Mix:** carga el modelo con nombres «Producto A» y «Producto B», mantiene los coeficientes y
  restricciones originales, y muestra el escenario («Producción · LP continuo») con roles visibles
  («producto», «recurso»). Sigue usando `/solve` y la Geometric View sin rutas especiales.
- **ScenarioDefinition:** `{ metadata, variableBindings, constraintBindings }`, con bindings por `id`
  y `role`. No hay campo `label`: la etiqueta es el `name` del modelo.
- **Estado:** `Sandbox` mantiene un `workspace` con `model` y `scenario`. Solo el `model` se envía a
  `/solve`; el escenario nunca se serializa.
- **Poda:** cada cambio elimina los bindings de entidades inexistentes, para que un id reutilizado
  nunca herede un rol antiguo.
- **Entidades nuevas:** nacen sin semántica y se muestran como «sin semántica».
- **Cambio de modelo:** reemplaza modelo, escenario, resultado y errores. Una respuesta tardía de un
  modelo anterior se descarta.

Detalle, lifecycle y limitaciones en [`SCENARIOS.md`](./SCENARIOS.md). Decisiones D12–D14 en
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

Riesgo conocido: elegir un template reemplaza el modelo sin confirmación, porque el proyecto no tiene
ningún mecanismo previo de protección contra cambios sin guardar.
