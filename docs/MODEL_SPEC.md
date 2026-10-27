# MODEL_SPEC — Representación canónica de modelos

**Estado:** contrato de la etapa M1 (programación lineal continua).
**Ámbito:** modelo lineal, solver HiGHS, API HTTP y futuras vistas matemáticas y geométricas.

Este documento define la **única representación canónica** de un modelo de optimización en
Optimization Sandbox. La UI, el solver y cualquier visualización futura deben consumir y producir
esta estructura. El solver construye sus propias matrices internas a partir de ella, pero nunca la
modifica ni se convierte en una segunda fuente de verdad.

---

## 1. Estructura general

```ts
OptimizationModel
├── variables: Variable[]
├── objective: Objective
└── constraints: Constraint[]
```

Un modelo es lineal, continuo y estático. No contiene estado de sesión, resultados ni información
de presentación derivada.

### Ejemplo completo

El modelo de demostración vive en [`templates/product-mix/model.json`](../templates/product-mix/model.json)
y es la única fuente de verdad para el frontend y los tests. El ejemplo siguiente es una versión
reducida con una sola restricción:

```json
{
  "variables": [
    {
      "id": "x1",
      "name": "x₁",
      "type": "continuous",
      "lowerBound": 0,
      "upperBound": null
    },
    {
      "id": "x2",
      "name": "x₂",
      "type": "continuous",
      "lowerBound": 0,
      "upperBound": null
    }
  ],
  "objective": {
    "sense": "maximize",
    "terms": [
      { "variableId": "x1", "coefficient": 40 },
      { "variableId": "x2", "coefficient": 30 }
    ]
  },
  "constraints": [
    {
      "id": "machine",
      "name": "Capacidad de máquina",
      "terms": [
        { "variableId": "x1", "coefficient": 2 },
        { "variableId": "x2", "coefficient": 1 }
      ],
      "operator": "<=",
      "rhs": 100
    }
  ]
}
```

El ejemplo anterior muestra una sola restricción por brevedad. El archivo real contiene las tres
restricciones de la demo de M1.

---

## 2. Tipos

### 2.1 `OptimizationModel`

| Campo         | Tipo           | Obligatorio | Descripción                              |
| ------------- | -------------- | ----------- | ---------------------------------------- |
| `variables`   | `Variable[]`   | sí          | Al menos una variable.                   |
| `objective`   | `Objective`    | sí          | Función objetivo.                        |
| `constraints` | `Constraint[]` | sí          | Puede estar vacío; un LP sin restricciones es válido. |

### 2.2 `Variable`

| Campo        | Tipo                  | Obligatorio | Descripción                                              |
| ------------ | --------------------- | ----------- | -------------------------------------------------------- |
| `id`         | `string`              | sí          | Identificador estable, no vacío y único en el modelo.    |
| `name`       | `string`              | sí          | Etiqueta de presentación, por ejemplo `x₁`.              |
| `type`       | `"continuous"`        | sí          | Único tipo admitido en M1.                              |
| `lowerBound` | `number \| null`      | sí          | Cota inferior. `null` significa −∞.                     |
| `upperBound` | `number \| null`      | sí          | Cota superior. `null` significa +∞.                     |

Los límites pertenecen a la variable, **no** se modelan como restricciones. La no negatividad
`x₁, x₂ ≥ 0` se expresa con `lowerBound: 0`.

### 2.3 `Objective`

| Campo   | Tipo                     | Obligatorio | Descripción                         |
| ------- | ------------------------ | ----------- | ----------------------------------- |
| `sense` | `"maximize" \| "minimize"` | sí        | Sentido de optimización.            |
| `terms` | `Term[]`                 | sí          | Al menos un término no repetido.    |

### 2.4 `Term`

| Campo         | Tipo     | Obligatorio | Descripción                          |
| ------------- | -------- | ----------- | ------------------------------------ |
| `variableId`  | `string` | sí          | Debe existir en `variables`.         |
| `coefficient` | `number` | sí          | Finito; puede ser cero o negativo.   |

### 2.5 `Constraint`

| Campo      | Tipo                          | Obligatorio | Descripción                                      |
| ---------- | ----------------------------- | ----------- | ------------------------------------------------ |
| `id`       | `string`                      | sí          | Identificador estable y único entre restricciones. |
| `name`     | `string`                      | sí          | Etiqueta legible, por ejemplo `Mano de obra`.    |
| `terms`    | `Term[]`                      | sí          | Al menos un término no repetido.                 |
| `operator` | `"<=" \| ">=" \| "="`         | sí          | Relación entre el lado izquierdo y `rhs`.        |
| `rhs`      | `number`                      | sí          | Término independiente, finito.                   |

Forma canónica: **toda la expresión lineal está en `terms` y toda la constante está en `rhs`**. No
se admiten constantes sueltas dentro de los términos ni expresiones con variables en ambos lados.

La UI muestra `<=`, `>=`, `=` como `≤`, `≥`, `=`; son símbolos de presentación, no valores del
contrato.

---

## 3. Reglas de validación

La validación autoritativa se ejecuta en el backend antes de llamar al solver.

1. `variables` contiene al menos un elemento y `objective.terms` al menos un término.
2. Los `id` de variables son únicos entre sí; los `id` de restricciones también.
3. Todo `variableId` referenciado existe en `variables`.
4. Una variable aparece como máximo una vez por lista de términos (objetivo o restricción).
5. `coefficient`, `rhs`, `lowerBound` y `upperBound` son números finitos cuando no son `null`.
6. Si ambas cotas existen, `lowerBound <= upperBound`.
7. `type` es `"continuous"`.
8. `id` y `name` no están vacíos.
9. El orden de variables, términos y restricciones se conserva.

Errores que no cumplen estas reglas se devuelven como **HTTP 422** con el sobre descrito en la
sección 6. No son estados del solver.

La cantidad de variables no está limitada por el contrato. La UI de M1 muestra un modelo de dos
variables, pero el solver y el contrato admiten cualquier LP continuo.

---

## 4. `OptimizationResult`

El resultado es una estructura independiente del modelo, que referencia variables y restricciones
por `id`.

```json
{
  "status": "optimal",
  "objectiveValue": 2200,
  "variableValues": [
    { "variableId": "x1", "value": 40 },
    { "variableId": "x2", "value": 20 }
  ],
  "constraints": [
    {
      "constraintId": "machine",
      "activity": 100,
      "rhs": 100,
      "slack": 0,
      "active": true
    },
    {
      "constraintId": "packaging",
      "activity": 60,
      "rhs": 100,
      "slack": 40,
      "active": false
    }
  ],
  "message": null
}
```

### 4.1 Campos

| Campo             | Tipo                 | Descripción                                              |
| ----------------- | -------------------- | -------------------------------------------------------- |
| `status`          | `SolveStatus`        | Estado de la resolución.                                 |
| `objectiveValue`  | `number \| null`     | Valor de la función objetivo; solo en `optimal`.         |
| `variableValues`  | `VariableValue[]`    | Valores por variable; solo en `optimal`.                 |
| `constraints`     | `ConstraintResult[]` | Evaluación por restricción; solo en `optimal`.           |
| `message`         | `string \| null`     | Descripción técnica; solo en `error`.                    |

`VariableValue`: `{ variableId: string, value: number }`.
`ConstraintResult`: `{ constraintId, activity, rhs, slack, active }`, donde `activity` es el valor
del lado izquierdo evaluado en la solución y `rhs` repite el término independiente del modelo para
que las visualizaciones no necesiten cruzar estructuras.

### 4.2 Invariantes por estado

| `status`     | `objectiveValue` | `variableValues`         | `constraints`            | `message` |
| ------------ | ---------------- | ------------------------ | ------------------------ | --------- |
| `optimal`    | número           | todas las variables, en orden | todas las restricciones, en orden | `null` |
| `infeasible` | `null`           | `[]`                     | `[]`                     | `null`    |
| `unbounded`  | `null`           | `[]`                     | `[]`                     | `null`    |
| `error`      | `null`           | `[]`                     | `[]`                     | string    |

En estados no óptimos no se inventan valores parciales ni aproximaciones.

### 4.3 Estados

| Estado       | Significado                                                     |
| ------------ | --------------------------------------------------------------- |
| `optimal`    | HiGHS encontró una solución óptima.                             |
| `infeasible` | No existe ningún punto que satisfaga todas las restricciones.   |
| `unbounded`  | El objetivo puede mejorar indefinidamente sin salir de la región factible. |
| `error`      | HiGHS no pudo resolver el modelo o devolvió un estado no concluyente. |

Mapeo desde HiGHS:

| HiGHS                                    | `status`     |
| ---------------------------------------- | ------------ |
| `kOptimal`                               | `optimal`    |
| `kInfeasible`                            | `infeasible` |
| `kUnbounded`                             | `unbounded`  |
| Cualquier otro (`kUnboundedOrInfeasible`, límites, error de modelo, etc.) | `error` |

Los estados ambiguos **no se adivinan**: se reportan como `error` con un mensaje que incluye el
estado devuelto por HiGHS.

---

## 5. Holgura y restricciones activas

La holgura se calcula una sola vez en el backend para que todas las vistas compartan la misma
definición:

- `<=`: `slack = rhs − activity`
- `>=`: `slack = activity − rhs`
- `=`: `slack = 0`

Una restricción está activa cuando:

```text
|activity − rhs| <= tolerance
tolerance = 1e-7 · max(1, |rhs|, |activity|)
```

Si `|slack| <= tolerance`, el slack se normaliza a `0` para no mostrar `-0` ni ruido numérico. El
resultado conserva los valores numéricos sin redondear; el formateo es responsabilidad de la UI.

`activity` se calcula a partir de los coeficientes canónicos y de los valores devueltos por HiGHS.
`objectiveValue` es el valor devuelto por HiGHS para el sentido original (`maximize` o `minimize`).

---

## 6. Contrato HTTP

### `POST /solve`

Cuerpo: un `OptimizationModel` directamente.

- `200`: `OptimizationResult` válido.
- `422`: modelo inválido. Sobre de error:

```json
{
  "error": {
    "code": "invalid_model",
    "message": "The optimization model is invalid.",
    "issues": [
      {
        "path": "constraints[0].terms[0].variableId",
        "message": "Unknown variable 'x3'."
      }
    ]
  }
}
```

Los mensajes técnicos de la API están en inglés; la UI los presenta dentro de su propio texto en
español. Un fallo interno inesperado del servidor puede devolver `500`; un fallo de resolución de
HiGHS se devuelve como `200` con `status: "error"`.

### `GET /health`

```json
{ "status": "ok" }
```

---

## 7. Fuera del contrato de M1

- Parser de expresiones escritas.
- Constantes dentro de términos.
- Variables enteras, binarias o semicontinuas.
- Objetivos múltiples, restricciones no lineales o cuádricas.
- Cotas expresadas como restricciones.
- Metadatos de presentación, escenas o parámetros nominales.
- Plantillas y su `ScenarioDefinition` (M4). Viven fuera de este contrato y nunca se envían a
  `/solve`; ver [`SCENARIOS.md`](./SCENARIOS.md).
- Persistencia o historial de resoluciones.

Cualquier extensión futura debe modificar este documento y mantener una única representación
canónica.
