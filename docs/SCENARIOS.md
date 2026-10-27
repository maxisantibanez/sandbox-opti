# SCENARIOS — Templates y semántica de escenario (M4)

Este documento describe cómo Optimization Sandbox distingue un modelo matemático genérico de un
modelo que además representa un problema real conocido. El contrato matemático sigue siendo
[`MODEL_SPEC.md`](./MODEL_SPEC.md); aquí solo se describe lo que vive fuera de él.

---

## 1. Dos estructuras separadas

| | `OptimizationModel` | `ScenarioDefinition` |
| --- | --- | --- |
| Contenido | variables, objetivo, restricciones | metadatos, bindings semánticos |
| Fuente de verdad | sí, la única en ejecución | no; solo referencia ids del modelo |
| Solver (`/solve`) | lo recibe completo | nunca lo recibe |
| Backend | lo valida (`schema.py`) | lo ignora; `extra="forbid"` lo rechazaría |
| Ubicación en frontend | `workspace.model` | `workspace.scenario` |

```text
OptimizationModel ──────────────→ Solver (/solve) → OptimizationResult
        │
        ├── Geometric View
        │
ScenarioDefinition ─┐
        │           │
        └───────────┴──→ Scenario View (M5) ←── OptimizationResult vigente
```

`OptimizationModel` no contiene nada de dominio: no hay etiquetas de escena, objetos 3D ni tipos de
escenario dentro de variables o restricciones. El escenario apunta al modelo, nunca al revés.

---

## 2. Blank Model y Template

- **Blank Model** («En blanco»): un `OptimizationModel` creado por el usuario sin semántica. Tiene
  `workspace.scenario = null`. Puede usar solver, resultados y Geometric View.
- **Template**: un punto de partida con tres partes: un `OptimizationModel` inicial, un
  `ScenarioDefinition` y su metadata. Tras cargarlo, el modelo es completamente editable; el template
  no se bloquea. Cargar un template copia el modelo (`structuredClone`) y no modifica los datos
  originales.

El primer template es **Product Mix** (`templates/product-mix/`).

---

## 3. Contrato de `ScenarioDefinition`

```ts
interface ScenarioDefinition {
  metadata: {
    id: string;          // "product-mix"
    name: string;        // "Product Mix"
    description: string;
    category: string;    // "production"
  };
  variableBindings: { variableId: string; role: VariableRole }[];
  constraintBindings: { constraintId: string; role: ConstraintRole }[];
}

type VariableRole = "product";
type ConstraintRole = "resource-capacity";
```

Definido en [`web/lib/scenario.ts`](../web/lib/scenario.ts). Es el contrato mínimo para M4: no hay
escenas, posiciones, colores ni parámetros nominales.

### Por qué no hay campo `label`

La etiqueta semántica que el usuario ve es el `name` de la variable o restricción en el modelo. Un
`label` propio duplicaría el nombre y podría contradecirlo tras un renombrado. Se eligió la solución
más simple y consistente: **la etiqueta sigue al `name`**.

Consecuencia: en Product Mix, `x1` se llama «Producto A» en el modelo. Renombrarlo a «Mesas» no
rompe el binding: sigue siendo un `product` con `variableId: "x1"`.

---

## 4. Bindings y IDs estables

- Un binding referencia **siempre** un `variableId` o `constraintId` del modelo.
- Nunca se referencia por posición en el array, por `name` visible ni por el texto de la ecuación.
- El `role` describe el significado matemático dentro del escenario (un producto, un recurso). No
  contiene nada visual.

Los `id` son internos y autogenerados (ver D8 en [`ARCHITECTURE.md`](./ARCHITECTURE.md)). Por eso el
contrato trabaja con ellos y no con nombres editables.

---

## 5. Estados semánticos

Cada entidad matemática se encuentra en uno de estos estados:

| Estado | Significado | Cómo aparece |
| --- | --- | --- |
| **bound** | existe un binding para su `id` | etiqueta con el rol («producto», «recurso») |
| **unbound** | existe en el modelo, sin binding | «sin semántica» en cursiva |
| **missing** | un binding apunta a un `id` que ya no existe | no se persiste: la poda lo elimina |

Una entidad **unbound** es matemáticamente válida. El sistema no le inventa significado a partir de
su nombre ni de su posición.

Los lookups (`variableRole`, `constraintRole`) son tolerantes: una referencia inexistente o un
escenario ausente devuelven `null` sin lanzar errores.

---

## 6. Lifecycle de bindings

### Cargar un template

Se copia el modelo y se adjunta el escenario del template. El estado inicial es coherente: todos los
bindings apuntan a entidades existentes.

### Editar matemáticamente

| Operación | Efecto sobre los bindings |
| --- | --- |
| Cambiar coeficientes, sentido, operador o RHS | ninguno |
| Renombrar variable o restricción | ninguno: el binding usa `id` |
| Agregar variable o restricción | la nueva entidad nace **unbound** |
| Agregar o eliminar términos | ninguno |
| Eliminar variable | se eliminan sus bindings en la misma transición |
| Eliminar restricción (directa o por cascada) | se elimina su binding en la misma transición |

### Poda obligatoria

`pruneScenario(scenario, model)` se ejecuta en cada cambio del modelo. Elimina cualquier binding cuyo
`id` ya no exista. Si no hay nada que eliminar, devuelve **el mismo objeto**, así que una edición no
relacionada no crea estado nuevo.

La poda es necesaria porque **los ids se reutilizan** (D8): al eliminar `x2`, el siguiente
`addVariable` vuelve a generar `x2`. Sin poda, la nueva variable heredaría el rol «producto» de la
anterior sin que nadie lo hubiera decidido.

### Cambiar de template o de modelo

Elegir un template o «En blanco» reemplaza el workspace completo: modelo, escenario, resultado y
errores. Una respuesta de `/solve` que llegue después de ese cambio se descarta; pertenece al modelo
anterior.

---

## 7. Edición estructural: qué ve el usuario

- Cada variable del «Dominio» y cada restricción muestra su estado semántico cuando hay escenario.
- Eliminar una entidad asociada la quita junto con su etiqueta, sin aviso adicional: la entidad
  desaparece de la vista y eso ya informa del cambio.
- La cascada de M2B (restricción que queda sin términos) actúa igual que una eliminación directa.
- En Blank Model no aparece ninguna etiqueta semántica.

---

## 8. Templates como datos

```text
templates/
└── product-mix/
    ├── model.json      OptimizationModel inicial (fuente única para frontend y tests de backend)
    └── scenario.json   metadata y bindings
```

`web/lib/templates.ts` es el registro: una lista de `{ model, scenario }` importada desde estos
archivos. Añadir un template exige crear su carpeta y añadir una entrada al registro. No hay sistema
de plugins ni descubrimiento automático.

Los JSON se validan de dos formas: el backend valida `model.json` en sus tests, y
`web/lib/scenario.test.ts` comprueba que cada binding apunta a un `id` existente y que los roles son
conocidos.

---

## 9. Reglas de lectura de los roles y Scenario View

Desde M5 la vista de escenario consume tres entradas sin modificarlas:

```text
ScenarioDefinition  → qué significa cada entidad
OptimizationModel   → cómo se relacionan (coeficientes, capacidades)
OptimizationResult  → qué solución produjo el solver
```

Cada rol define una **regla de lectura** del modelo, de modo que las relaciones no se duplican en
`scenario.json`:

| Rol | Entidad | Lectura |
| --- | --- | --- |
| `product` | variable | decisión de producción; su coeficiente objetivo es el «aporte a Z por unidad», sin semántica de beneficio o coste |
| `resource-capacity` | restricción | recurso con capacidad `rhs`; el coeficiente de cada `product` es su consumo por unidad |

La lectura de capacidad solo se aplica si la forma es compatible: operador `<=`, `rhs >= 0`,
coeficientes de productos ≥ 0 y productos con `lowerBound >= 0`. Si una edición rompe alguna
condición, la vista marca el recurso como «no interpretable como capacidad» y no lo reinterpreta.
Las variables sin binding que aparecen en un recurso cuentan como uso sin representación.

`capacity / coefficient` se muestra como **límite teórico impuesto por este recurso**, nunca como
máximo global del producto. La implementación, la escena *Production Floor* y sus estados están en
[`SCENARIO_3D.md`](./SCENARIO_3D.md).

---

## 10. Limitaciones actuales

- Solo hay dos roles: `product` (variables) y `resource-capacity` (restricciones), y una vista de
  escenario (Product Mix).
- El escenario no define unidades ni la semántica del objetivo; la vista no las inventa.
- No existe editor de bindings: el usuario no puede asignar ni cambiar roles en la UI.
- Los bindings solo cubren variables y restricciones; el objetivo no tiene semántica propia.
- Un template solo se puede cargar reemplazando el modelo actual. Si el modelo tiene cambios sin
  conservar, la UI pide confirmación antes de reemplazarlo (ver `CURRENT_STATE.md`, sección 23).
- No hay persistencia: ni modelos ni escenarios se guardan entre sesiones.
- El backend no conoce los escenarios y debe seguir así; `/solve` rechaza cualquier campo extra.
- Solo hay un template. La estructura lo admite, pero no se probó con varios.
