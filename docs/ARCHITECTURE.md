# ARCHITECTURE — Optimization Sandbox

**Estado:** M1 + M2A + M2B + M3 + M4 + M5 (pipeline, constructor de modelos, vista geométrica 2D,
templates con semántica de escenario y primera Scenario View 3D).
**Documento de referencia del contrato:** [`MODEL_SPEC.md`](./MODEL_SPEC.md).

---

## 1. Principio rector

El producto es un sandbox de modelamiento matemático para optimización: el usuario construye un
modelo y la aplicación le ayuda a comprender su formulación y el sistema que representa. La
programación lineal continua es la primera familia de modelos soportada, no la identidad del
producto. La cadena que debe funcionar y mantenerse limpia es:

```text
modelo estructurado
      ↓
OptimizationModel (JSON canónico)
      ↓
solver HiGHS
      ↓
OptimizationResult (JSON estructurado)
      ↓
interfaz
```

La UI no contiene matemáticas del solver. El backend no contiene lógica de presentación. Ambos se
comunican exclusivamente mediante el contrato descrito en `MODEL_SPEC.md`.

Las visualizaciones —matemática, geométrica o por escenarios— son consumidoras de las mismas
estructuras, nunca modelos paralelos.

---

## 2. Componentes

```text
┌──────────────────────────────┐
│ web/                         │
│ Next.js + React + TypeScript │
│                              │
│ editor matemático            │
│ panel de resultados          │
└──────────────┬───────────────┘
               │ HTTP/JSON
               │ POST /solve
               ▼
┌──────────────────────────────┐
│ solver/                      │
│ FastAPI + highspy (HiGHS)    │
│                              │
│ api.py        rutas HTTP     │
│ validation.py reglas         │
│ highs_solver.py adaptador    │
│ schema.py     contrato       │
└──────────────────────────────┘
```

### 2.1 Frontend (`web/`)

- **Next.js + React + TypeScript**, una sola página.
- Al empezar, el usuario elige un modelo en blanco o un template (ver 2.6). El modelo cargado se
  copia y a partir de ahí el estado es el `OptimizationModel` canónico; los archivos de
  `templates/` no se modifican.
- El editor permite cambiar sentido, coeficientes, operadores y lados derechos. Cada cambio produce
  un nuevo `OptimizationModel` mediante funciones puras de `lib/model-editing.ts`.
- Desde M2B, `lib/model-editing.ts` también contiene las operaciones estructurales: agregar y
  eliminar variables, términos y restricciones, y renombrar variables y restricciones. Todas
  producen un `OptimizationModel` válido; cuando una operación no puede aplicarse, devuelven el
  mismo objeto (un no-op no marca la solución como obsoleta).
- No hay representación textual paralela ni parser: los campos numéricos y los campos de nombre
  mantienen un borrador local transitorio y solo confirman valores completos al modelo canónico.
- Al pulsar **Resolver**, envía el estado actual por HTTP y muestra el `OptimizationResult`.
- No conoce HiGHS ni transforma el modelo. Solo presenta la matemática y formatea números.
- Si el modelo cambia después de resolver, el resultado anterior se conserva pero se marca como
  obsoleto. El estado de la última resolución guarda una referencia al modelo con el que se resolvió;
  la comparación es por identidad, porque toda edición crea un objeto nuevo.

### 2.2 Backend (`solver/`)

- **FastAPI** como capa HTTP fina y sin estado.
- **Pydantic** valida la forma del contrato (tipos, campos obligatorios, números finitos).
- **`validation.py`** aplica las reglas cruzadas que Pydantic no puede expresar: unicidad de IDs,
  referencias a variables, términos duplicados y coherencia de cotas.
- **`highs_solver.py`** construye el problema de HiGHS desde el modelo canónico, ejecuta el solver,
  mapea estados y calcula `activity`, `slack` y `active`.
- No hay base de datos, caché, sesiones ni estado entre peticiones.
- No hay parser de texto. El contrato entra ya estructurado.

### 2.3 Modelo de ejemplo compartido

`templates/product-mix/model.json` es la única fuente de verdad para los coeficientes, límites y nombres
del caso de demostración. Lo consumen:

- el frontend, a través del registro de templates, para inicializar el estado editable;
- los tests del backend, que lo cargan desde disco.

Así se evita que los tests repitan los números mágicos de la demo. Las expectativas de la solución
(40, 20, 2200, holguras) sí viven en los tests, porque son aserciones matemáticas, no definición del
modelo.

El frontend importa el JSON directamente. Para permitir ese import fuera de `web/`, `next.config.ts`
fija `turbopack.root` en la raíz del repositorio.

### 2.4 Edición de números y nombres, y estados transitorios

`components/math-number-input.tsx` y `components/math-text-input.tsx` son los únicos puntos que
mantienen texto de edición. Es un borrador local, no una segunda representación del modelo:

- cada pulsación intenta interpretar el texto como un número finito o un nombre no vacío;
- si es válido, actualiza inmediatamente el `OptimizationModel`;
- si está incompleto (`""`, `"-"`, `"2,"` o un nombre vacío), conserva el último valor confirmado;
- al perder el foco, vuelve a mostrar el valor confirmado.

Por eso un campo vacío nunca se convierte en `0` ni en un nombre en blanco, y nunca se envía un
modelo con valores inventados. El resto de la UI consume exclusivamente el modelo canónico.

### 2.5 Geometría 2D (M3)

`lib/geometry.ts` deriva fronteras, semiplanos, bounds, factibilidad geométrica y viewport desde el
`OptimizationModel` vigente. `components/geometric-view.tsx` dibuja esos datos con SVG. No hay
estado matemático adicional editable ni cambios en `/solve`. El óptimo y `active` proceden solo del
`OptimizationResult` vigente; editar oculta el punto anterior y elimina su influencia en el viewport.

El layout coloca modelo y geometría en columnas en escritorio, con resultados debajo. Hover/foco
comparte únicamente un `constraintId` de presentación; no modifica el modelo ni invalida resultados.
La vista requiere dos variables y muestra estados informativos para las demás dimensiones.

Algoritmos, casos degenerados, tolerancias y límites se documentan en [`GEOMETRY.md`](./GEOMETRY.md).

### 2.6 Templates y ScenarioDefinition (M4)

`Sandbox` mantiene un único `workspace = { title, subtitle, model, scenario }`. `model` es el
`OptimizationModel` en ejecución; `scenario` es un `ScenarioDefinition` opcional (`null` en modelo en
blanco) que solo referencia ids del modelo. El escenario nunca contiene matemática y nunca llega a
`/solve`.

- `lib/scenario.ts` define el contrato semántico, las búsquedas de rol por id y la poda de bindings.
- `lib/templates.ts` es el registro de templates; cada uno es `{ model, scenario }` importado desde
  `templates/<id>/`.
- `lib/blank-model.ts` construye el modelo en blanco.
- `components/model-start.tsx` es el selector «Nuevo modelo» (En blanco y Templates).

Cada cambio del modelo pasa por la poda, de modo que ningún binding apunta a un id inexistente. Un id
reutilizado nunca hereda un significado antiguo. Detalle completo en [`SCENARIOS.md`](./SCENARIOS.md).

### 2.7 Scenario View (M5)

La segunda columna es el panel **Visualización** (`components/visualization-panel.tsx`) con tabs
Geometría y, si el escenario tiene una vista registrada, Escenario. `components/scenario-views.ts`
es el registro `scenario.metadata.id → vista`; es el único lugar que compara ids de escenario.

```text
OptimizationModel + ScenarioDefinition + {model, result} vigente
        ↓  lib/product-mix-scene.ts      definition (sistema) + solution (estado)   puro
        ↓  lib/product-mix-layout.ts     normalización y escala visual acotada       puro
        ↓  components/scenario/product-mix-view.tsx    texto del sistema, estados, fallback
        ↓  components/scenario/product-mix-canvas.tsx  React Three Fiber (solo cliente)
```

- `definition` existe antes de resolver: productos, recursos, capacidad (`rhs`) y consumos
  (coeficientes). Se lee del modelo según las reglas del rol; nada se duplica en `scenario.json`.
- `solution` solo existe con un resultado del modelo vigente (identidad `solved.model === model`):
  cantidades, actividad, holgura y `active` del backend, más la explicación `a·x` por producto.
- `Sandbox` comparte un `Highlight { constraintId, variableId }` de presentación entre editor,
  geometría y escena; un par `{c, v}` resalta un único término.
- El canvas se carga con `next/dynamic(..., { ssr: false })`; un error boundary y la detección de
  WebGL aíslan los fallos del renderer.

Detalle en [`SCENARIO_3D.md`](./SCENARIO_3D.md).

---

## 3. Flujo de una resolución

1. La página inicializa el estado editable desde el modelo de ejemplo.
2. El usuario modifica la expresión matemática directamente.
3. El usuario pulsa **Resolver**. Se toma una instantánea del modelo actual.
4. El frontend serializa esa instantánea y la envía a `POST /solve`.
5. FastAPI valida la forma con Pydantic.
6. `validate_model` comprueba las reglas cruzadas. Si hay errores, responde `422`.
7. El adaptador crea un problema HiGHS:
   - una columna por variable, con sus cotas;
   - costes de la función objetivo y sentido;
   - una fila por restricción, con cotas de fila derivadas de `operator` y `rhs`.
8. HiGHS resuelve. El adaptador mapea el estado.
9. Si es `optimal`, extrae valores, calcula objetivo y evalúa cada restricción.
10. El backend serializa un `OptimizationResult` con `200`.
11. La UI muestra estado, variables, objetivo y la tabla de restricciones.
12. Si el modelo cambia después, el resultado se conserva marcado como obsoleto hasta la siguiente
    resolución.

El adaptador **no muta** el `OptimizationModel`. La conversión a matrices es un detalle interno y
desechable.

---

## 4. Frontera HTTP y errores

| Situación                                | Respuesta                                      |
| ---------------------------------------- | ---------------------------------------------- |
| Modelo válido y resuelto                 | `200` + `OptimizationResult`                   |
| Modelo inválido (forma o reglas)         | `422` + sobre `{ error: { code, message, issues } }` |
| Fallo de resolución de HiGHS             | `200` + `status: "error"` + `message`          |
| Fallo interno no controlado              | `500`                                          |
| Servicio caído o CORS                    | Error de red mostrado por la UI                |

La distinción es deliberada: un modelo mal formado es un error de petición; un modelo bien formado
que el solver no puede resolver es un resultado del dominio.

La URL del backend se configura con `NEXT_PUBLIC_SOLVER_URL` (por defecto
`http://127.0.0.1:8000`). Los orígenes permitidos por CORS se configuran con `CORS_ORIGINS`
(por defecto los puertos locales 3000).

---

## 5. Estructura del repositorio

```text
/
├── VISION.md
├── MVP.md
├── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CURRENT_STATE.md
│   ├── GEOMETRY.md
│   ├── MODEL_SPEC.md
│   ├── SCENARIO_3D.md
│   └── SCENARIOS.md
├── templates/
│   └── product-mix/
│       ├── model.json
│       └── scenario.json
├── solver/
│   ├── pyproject.toml
│   ├── src/optimization_sandbox/
│   │   ├── __init__.py
│   │   ├── api.py
│   │   ├── highs_solver.py
│   │   ├── schema.py
│   │   └── validation.py
│   └── tests/
│       ├── conftest.py
│       ├── test_api.py
│       ├── test_highs_solver.py
│       └── test_validation.py
└── web/
    ├── app/
    │   ├── globals.css
    │   ├── layout.tsx
    │   └── page.tsx
    ├── components/
    │   ├── geometric-view.tsx
    │   ├── math-number-input.tsx
    │   ├── math-text-input.tsx
    │   ├── model-editor.tsx
    │   ├── model-start.tsx
    │   ├── results-panel.tsx
    │   ├── sandbox.tsx
    │   ├── scenario-views.ts
    │   ├── visualization-panel.tsx
    │   └── scenario/
    │       ├── product-mix-canvas.tsx
    │       ├── product-mix-view.tsx
    │       ├── scene-error-boundary.tsx
    │       └── tones.ts
    ├── lib/
    │   ├── blank-model.ts
    │   ├── geometry.ts
    │   ├── format.ts
    │   ├── highlight.ts
    │   ├── model-editing.ts
    │   ├── model.ts
    │   ├── number-input.ts
    │   ├── product-mix-layout.ts
    │   ├── product-mix-scene.ts
    │   ├── scenario.ts
    │   ├── solve.ts
    │   ├── templates.ts
    │   └── webgl.ts
    ├── next.config.ts
    ├── package.json
    ├── tsconfig.json
    └── vitest.config.mts
```

No se crean capas adicionales (`services`, `use cases`, repositorios, inyección de dependencias)
mientras no exista una necesidad real.

---

## 6. Decisiones y alternativas descartadas

### D1. Python + HiGHS en lugar de un solver JS

HiGHS es el solver que el producto necesita a medida que crezca (LP y, más adelante, MILP), con
bindings oficiales y buena mantenibilidad. Un solver JS habría reducido el número de procesos, pero
habría atado la matemática al frontend y probablemente exigido una migración temprana.

**Coste aceptado:** dos procesos locales y un pequeño contrato HTTP.

### D2. JSON canónico como frontera, no código compartido

No hay generación de tipos entre Python y TypeScript en M1/M2A/M2B. El contrato se documenta y se
replica en `lib/model.ts` y `schema.py`. Se acepta una duplicación pequeña y explícita antes que
añadir codegen, un paquete compartido o un esquema ejecutable.

**Revisión futura:** cuando el editor evolucione y el contrato cambie con frecuencia, generar tipos
TS desde OpenAPI puede pasar a ser rentable.

### D3. Slack y `active` se calculan en el backend

Así la UI, los tests y las futuras vistas geométricas comparten una única definición. Dejar el
cálculo en cada vista invitaría a divergencias sutiles.

### D4. Sin parser textual

El modelo se construye siempre como `OptimizationModel`. M2A añade edición inline sobre ese mismo
modelo, no un parser: los campos numéricos solo convierten texto en números individuales. Un parser
de expresiones seguiría siendo una segunda fuente de verdad y trabajo desechable.

### D5. Next.js en lugar de una SPA más pequeña

Vite + React habría sido algo más ligero para una sola página. Next.js se elige por ser la base
indicada para el producto y evitar una reescritura cuando aparezcan rutas, plantillas o
documentación. En M1/M2A/M2B no se usan SSR, rutas dinámicas ni API routes de Next.

### D6. Un único endpoint de resolución

No hay endpoints de “crear modelo”, “guardar” o “historial”. El servidor es una función matemática
sin estado; añadir persistencia ahora sería funcionalidad fuera del MVP.

### D7. Erratas en `MVP.md`

`MVP.md` escribe las restricciones de la demo con `=` y la no negatividad como `x1 = 0`, `x2 = 0`.
Se interpretan como erratas: el modelo canónico usa `<=` y cotas `x1, x2 >= 0`, coherente con
`VISION.md` y con el objetivo de visualizar una región factible. Si fueran igualdades, la región
sería un único punto y la demo geométrica del MVP no tendría sentido.

### D8. Identidades generadas, nombres editables

Los `id` (`x3`, `constraint1`) son internos, estables y autogenerados; la UI nunca los edita. El
siguiente id se calcula escaneando los existentes (`x<N>` / `constraint<N>` máximo + 1). Al eliminar
el ID con el sufijo mayor, ese sufijo puede reutilizarse; los huecos intermedios no se rellenan.
El `name` es presentación
y sí es editable inline (`x₃` → `Producto A`); renombrar nunca rompe referencias porque los
términos apuntan al `id`. Un nombre en blanco se rechaza en el cliente y el borrador transitorio
evita enviarlo.

### D9. Eliminar una variable es una cascada visible

Al eliminar una variable se eliminan sus términos en el objetivo y en todas las restricciones. Una
restricción que queda sin términos desaparece con ella: una desigualdad sin lado izquierdo no
existe y el contrato exige al menos un término por restricción. La alternativa (bloquear la
eliminación hasta borrar la restricción a mano) fue descartada por introducir fricción artificial.
La UI informa el efecto con un aviso discreto (`Se eliminó 1 restricción que quedó vacía.`) y la
cascada, como cualquier otra edición, marca la solución anterior como obsoleta. Las operaciones que
el contrato no permite (única variable del modelo, único término del objetivo) están deshabilitadas
con su motivo.

### D10. Los términos no tienen identidad propia

Un `Term` se identifica por su `variableId`: el contrato admite una variable como máximo una vez
por lista de términos. Por eso «cambiar la variable de un término» es eliminarlo y agregar otro,
el control «+ término» solo ofrece variables aún no presentes en esa expresión, y no existen ids
de término que mantener sincronizados. Las restricciones nuevas nacen sembradas
(`1·x₁ ≤ 0`, etiqueta `Restricción N`) porque el contrato exige al menos un término; todo el resto
de la fila es editable inmediatamente. Los términos nuevos comienzan con coeficiente `1`.

### D12. La semántica vive fuera de OptimizationModel

Un template es un modelo más un `ScenarioDefinition` que lo describe. El escenario referencia variables
y restricciones por `id` y no modifica el contrato canónico: no hay campos de escena ni de dominio en
`OptimizationModel`, y el backend rechaza cualquier campo extra en `/solve`. Así, cuando llegue la
Scenario View, consumirá modelo, escenario y resultado sin que el solver sepa nada del escenario.

### D13. La etiqueta semántica es el nombre del modelo

El binding no tiene campo `label`: el texto que se muestra es el `name` de la entidad. Duplicar el
nombre en el escenario abriría la puerta a dos verdades que pueden divergir tras un renombrado. Por
eso Product Mix llama «Producto A» a `x1` directamente en `templates/product-mix/model.json`.

### D14. Poda de bindings en cada cambio y ids reutilizados

Los ids se reutilizan (D8). Un binding que sobreviviera a la eliminación de su entidad podría asignar
un significado a una variable nueva que recibe el mismo id. Por eso cada cambio del modelo poda los
bindings huérfanos en la misma transición, y las búsquedas toleran referencias ausentes sin lanzar
errores. No se implementa un sistema de migraciones ni avisos sobre bindings eliminados.

### D15. La Scenario View representa el sistema; la solución es estado añadido

La escena no es un panel de métricas en 3D. Su modelo derivado separa `definition` (el sistema que
describe el modelo, disponible antes de resolver y actualizado con cada edición) y `solution` (lo
que añade un resultado vigente). Resolver añade estado al sistema; no lo crea. Un resultado obsoleto,
infactible, no acotado o erróneo deja el sistema visible y no aporta ningún valor de solución.

### D16. El rol define una regla de lectura, no datos duplicados

`ScenarioDefinition` dice qué significa cada entidad; las relaciones salen de la matemática. En una
restricción `resource-capacity`, el coeficiente de un `product` es su consumo por unidad y el `rhs` la
capacidad. La lectura solo se aplica si la forma es compatible (`<=`, `rhs >= 0`, consumos ≥ 0 y
productos no negativos). En otro caso el recurso es «no interpretable como capacidad» y no se
reinterpreta. Se descartó añadir consumos o unidades a `scenario.json`: duplicaría coeficientes que
ya viven en el modelo. El contrato de M4 no cambió.

### D17. `a·x` explica la actividad; `activity` sigue siendo la autoridad

La descomposición del uso de un recurso por producto (`coeficiente · cantidad`) se calcula en el
adapter del frontend. Es una evaluación del modelo en la solución, no una resolución. `activity`,
`slack` y `active` siguen viniendo del backend (D3). Si la suma no coincide con `activity` dentro de
`1e-7 · max(1, |activity|, max|a·x|)`, se marca la discrepancia y no se dibujan segmentos, sin
ajustar ningún dato.

### D18. React Three Fiber sin `drei`, cargado solo en el cliente

`three` + `@react-three/fiber` permiten una escena declarativa y testeable por capas. `drei` se
descartó porque solo hacían falta controles orbitales (incluidos en `three`) y etiquetas HTML
ancladas (proyección propia), y añadía unas 20 dependencias transitivas. La escena es procedural,
sin assets externos. El canvas es un chunk diferido con `ssr: false`, aislado por un error boundary.
La escala visual se normaliza por recurso, porque las capacidades de recursos distintos no son
comparables.

### D11. Geometría derivada y SVG nativo

La geometría es una proyección desechable del contrato para exactamente dos variables. Se separan
M3A (cómputo puro), M3B (SVG) y M3C (layout y coordinación). SVG permite interacciones por identidad,
recorte y accesibilidad sin incorporar una librería de gráficos. La región se clasifica antes de
recortarla; las igualdades pueden producir segmentos o puntos y los conjuntos infinitos se muestran
como una ventana abierta de la región. HiGHS conserva la autoridad sobre el óptimo y la actividad.

---

## 7. Desarrollo local

Dos terminales:

```powershell
# Terminal 1 — backend
cd solver
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn optimization_sandbox.api:app --reload --port 8000
```

```powershell
# Terminal 2 — frontend
cd web
npm install
npm run dev
```

Abrir `http://localhost:3000`. El backend expone documentación interactiva en
`http://127.0.0.1:8000/docs`.

---

## 8. Testing

### Backend

- `pytest` desde `solver/`.
- Casos del adaptador: óptimo (modelo de ejemplo compartido), modelo de tres variables, minimización,
  infactible, no acotado, igualdad, mapeo de estados de error.
- Validación: referencias desconocidas, IDs duplicados, términos duplicados y cotas incoherentes.
- API: `POST /solve` correcto, `422` con sobre de error y `GET /health`.

### Frontend

- `npm test` ejecuta Vitest con Testing Library sobre jsdom.
- Se verifica que la edición de coeficientes, sentido, operadores y RHS produce el modelo enviado.
- Se verifica cada operación estructural de M2B: agregar y eliminar variables (con cascada y aviso),
  agregar y eliminar términos, agregar y eliminar restricciones, y renombrar variables y
  restricciones inline.
- Se verifican los guardas del contrato: el último término del objetivo, el último término de una
  restricción y la única variable del objetivo no se pueden eliminar; el selector «+ término» solo
  aparece con variables disponibles.
- Se verifica que cada edición afecta a la restricción correcta y que un campo vacío no se convierte
  en `0` ni un nombre vacío en un nombre en blanco.
- Se verifica que resolver usa el modelo vigente y que editarlo después (numérica o
  estructuralmente) marca el resultado como obsoleto.
- `npm run build` debe compilar sin errores de TypeScript.
- M3 añade `geometry.test.ts` y `geometric-view.test.tsx`: casos geométricos 2D, edición inmediata,
  óptimo vigente, obsolescencia y respuestas tardías, dimensiones, exploración e hidratación SSR.
- M4 añade `scenario.test.ts` (poda de bindings, ids reutilizados, renombrado, plantilla y modelo en
  blanco) y los tests de `sandbox.test.tsx` para el selector, los roles visibles, el cambio de modelo y
  el payload de `/solve`.
- M5 añade `product-mix-scene.test.ts` (sistema, solución, descomposición, interpretabilidad,
  obsolescencia, normalización y layout) y `scenario-view.test.tsx` (tabs, invalidación, hover
  editor ↔ escena, desmontaje, fallos de WebGL y SSR) con el canvas sustituido por un doble.
- Verificación manual E2E con Chrome y el backend real: construir desde la UI el modelo de tres
  variables `Max Z = 5x₁ + 8x₂ + 2x₃` (x₁ = 0, x₂ = 100, x₃ = 26,6667, Z = 853,3333), comprobar el
  aviso obsoleto, la cascada al eliminar una variable y el renombrado inline. Playwright no forma
  parte de la suite versionada.

---

## 9. Camino posterior (fuera de M1–M5)

1. Más templates, roles y vistas de escenario, sin sistema de plugins genérico. Posibles extensiones
   del escenario (unidades, semántica del objetivo) solo cuando una vista las necesite.
2. Parámetros con nombre en el modelo, previa extensión de `MODEL_SPEC.md`.
3. Otros tipos de variables y modelos, previa extensión de `MODEL_SPEC.md`.

Ninguna de estas etapas debe introducir una representación paralela del modelo.
