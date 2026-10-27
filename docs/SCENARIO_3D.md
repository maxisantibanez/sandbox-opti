# SCENARIO_3D — Production Floor (M5)

La Scenario View representa **el sistema que el modelo describe**. La solución de HiGHS se añade
después como estado de ese sistema. No es un dashboard de resultados en 3D: antes de resolver ya
existen los productos, los recursos, sus capacidades y las relaciones de consumo. Resolver añade
estado al sistema; no lo crea.

Primer escenario: **Product Mix — Production Floor**.

```text
ScenarioDefinition  → qué significa cada entidad        (product, resource-capacity)
OptimizationModel   → cómo se relacionan las entidades   (coeficientes, capacidades)
OptimizationResult  → qué solución produjo el solver     (cantidades, actividad, activa)
```

La vista combina las tres sin modificar ninguna. `OptimizationModel`, `OptimizationResult`,
`ScenarioDefinition`, `/solve` y el backend no cambiaron en M5.

---

## 1. Arquitectura

```text
workspace.model ─────┐
workspace.scenario ──┼─► buildProductMixScene()        lib/product-mix-scene.ts   (M5A, puro)
outcome {model,result}┘        │ ProductMixScene { definition, solution }
                               ▼
                    layoutProductMixScene()             lib/product-mix-layout.ts  (M5A, puro)
                               │ FloorLayout (unidades de mundo acotadas)
                               ▼
scenarioViewFor(scenario) → ProductMixScenarioView      components/scenario/product-mix-view.tsx  (M5C, DOM)
                               └─ next/dynamic(ssr:false) → ProductMixCanvas
                                                         components/scenario/product-mix-canvas.tsx (M5B, WebGL)
```

| Capa | Responsabilidad | No hace |
| --- | --- | --- |
| `product-mix-scene.ts` | Lee el sistema del modelo y la solución vigente | Nada visual; no resuelve |
| `product-mix-layout.ts` | Convierte magnitudes normalizadas en alturas y posiciones acotadas | No lee el modelo |
| `product-mix-view.tsx` | Estado de la solución, texto del sistema, leyendas, fallback, carga diferida | No calcula matemática |
| `product-mix-canvas.tsx` | Dibuja el layout con React Three Fiber, cámara, etiquetas, hover | No deriva datos |
| `scenario-views.ts` | Registro `scenario.metadata.id → vista` | Nada más compara ids de escenario |
| `visualization-panel.tsx` | Panel «Visualización» con tabs Geometría / Escenario | — |

El registro es un `Record` explícito con una sola entrada (`"product-mix"`). No hay sistema de
plugins: añadir otra vista es añadir otra entrada.

## 2. Dependencias

| Paquete | Versión | Motivo |
| --- | --- | --- |
| `three` | 0.186 | Motor WebGL. `OrbitControls` viene en `three/examples/jsm`, sin paquete extra. |
| `@react-three/fiber` | 9.8 | Escena declarativa en React; reconciliador, eventos de puntero y bucle *on demand*. Requiere React `>=19 <19.4` (el proyecto usa 19.3). |
| `@types/three` | 0.186 (dev) | Tipos de `three`. |

**No se usa `@react-three/drei`.** Solo se necesitaban controles orbitales (incluidos en `three`) y
etiquetas HTML ancladas (unas 40 líneas en `LabelProjector`). `drei` añade unas 20 dependencias
transitivas (hls.js, mediapipe, troika, camera-controls…). No hay assets externos, fuentes 3D,
HDRI ni postprocessing: toda la escena se construye con cajas y líneas.

## 3. Lectura del sistema: reglas del rol `resource-capacity`

El escenario solo dice **qué significa** cada entidad. Las relaciones salen de la matemática, sin
duplicarse en `scenario.json`. Para una restricción con rol `resource-capacity`:

- cada término de una variable con rol `product` y coeficiente ≠ 0 se lee como «el producto usa
  *a* unidades del recurso por unidad producida»;
- el `rhs` es la **capacidad** del recurso;
- un coeficiente 0 no crea relación.

Esa lectura solo se aplica si la forma es compatible (`capacityIssues` vacío):

| Condición | Si no se cumple |
| --- | --- |
| operador `<=` | `operator` |
| `rhs >= 0` | `negative-capacity` |
| coeficientes de productos representados ≥ 0 | `negative-consumption` |
| productos que usan el recurso con `lowerBound >= 0` | `product-domain` |

Un recurso con algún problema se muestra **«no interpretable como capacidad»**: contorno
discontinuo, canales en gris, sin porcentaje ni límites teóricos. No se reinterpreta (por ejemplo,
un `≥` no se convierte en «demanda mínima»).

## 4. Scene Model

```ts
ProductMixScene {
  definition: SystemDefinition   // existe antes de resolver; cambia con cada edición
  solution:   SceneSolution      // solo con un resultado del modelo vigente
}

SystemDefinition {
  objectiveSense
  products:     { variableId, name, objectiveCoefficient, lowerBound, upperBound, nonNegative }[]
  resources:    { constraintId, name, operator, capacity, capacityIssues[], unrepresentedVariableIds[] }[]
  consumptions: { constraintId, variableId, coefficient, resourceLimit }[]
  unboundCount
}

SceneSolution =
  | unsolved | stale | infeasible | unbounded | error{message}
  | optimal { objectiveValue,
              products:  { variableId, quantity, normalized }[],
              resources: { constraintId, activity, slack, active, utilization,
                           shares: { variableId, amount }[], unrepresentedAmount,
                           decompositionMatches }[] }
```

- **`objectiveCoefficient`** se presenta como «aporte a Z por unidad». No hay semántica de
  beneficio o coste: vale igual con minimización y coeficientes negativos. Una variable sin término
  objetivo tiene coeficiente 0.
- **`resourceLimit = capacity / coefficient`**: el **límite teórico impuesto por este recurso** si
  solo se produjera ese producto. No es un máximo global, porque las demás restricciones también
  aplican. Es `null` cuando la lectura de capacidad no se cumple.
- **`activity`, `slack` y `active`** vienen del backend. `activity` es la autoridad.
- **`utilization = activity / capacity`** solo si el recurso es interpretable y `capacity > 0`.
  Capacidad 0 → `null`: nunca `Infinity` ni `NaN`.
- **`shares`** es la explicación de la actividad: `coeficiente · cantidad` por producto, calculado
  en el adapter. `unrepresentedAmount` suma el uso de variables sin semántica dentro del recurso.

### Descomposición y tolerancia

```text
|Σ aᵢ·xᵢ − activity| ≤ 1e-7 · max(1, |activity|, max |aᵢ·xᵢ|)
```

Es la misma tolerancia relativa que `active` en el backend (MODEL_SPEC §5), escalada por la mayor
magnitud para no juzgar sumas con cancelación contra un total pequeño. Si no se cumple:

- `decompositionMatches = false`;
- los segmentos por producto **no se dibujan**: el recipiente muestra solo el relleno de `activity`;
- el texto del sistema avisa «la suma de a·x no coincide con la actividad de HiGHS».

Los datos no se ajustan: `activity` y `shares` se conservan tal como son.

## 5. Normalización visual

Ningún valor matemático se usa como coordenada. Las posiciones dependen solo del número de
entidades (filas centradas). Las magnitudes se normalizan primero y luego se acotan:

| Magnitud | Normalización | Escala visual |
| --- | --- | --- |
| Capacidad de un recurso | **local**: cada recipiente es su propio 100 % | altura fija `1,5` |
| Uso del recurso | `activity / capacity`, recortado a [0, 1] para dibujar | `fill · 1,5` |
| Segmentos por producto | `amount / capacity`, apilados y recortados al recipiente | dentro de `1,5` |
| Coeficiente de consumo | relativo al mayor coeficiente **del mismo recurso** | ancho del canal `0,05–0,2` |
| Cantidad de producto | relativa a la mayor cantidad representada | altura `0,05–1,6`; `0` si la cantidad es 0 |

Los recursos se miden en unidades distintas (horas de máquina, horas de trabajo…). Por eso no se
comparan capacidades ni coeficientes entre recursos. Las cantidades de producto sí se comparan entre
sí; si los productos tuvieran unidades distintas, la comparación de alturas sería solo orientativa.
Las etiquetas muestran siempre el valor verdadero (`cantidad 50 000`, `100 / 100 · 100 %`).

Una cantidad positiva muy pequeña frente a otra muy grande recibe la altura mínima `0,05`, para no
confundirse con cero.

## 6. Mapping matemático → representación

| Matemática | Representación |
| --- | --- |
| variable `product` | estación de producto en la fila frontal; su tono la identifica en toda la escena |
| restricción `resource-capacity` | recipiente sobre un pedestal en la fila del fondo |
| `rhs` | altura completa del recipiente (etiqueta `capacidad 100`) |
| coeficiente `aᵢⱼ` | canal entre producto y recurso, con ancho local y etiqueta numérica |
| cantidad `xⱼ` (resuelto) | columna del producto, en su tono |
| `aᵢⱼ·xⱼ` (resuelto) | segmento del tono del producto dentro del recipiente |
| holgura | espacio vacío del recipiente (etiqueta `holgura 40`) |
| `active` (HiGHS) | **tapa** oscura sobre el recipiente y etiqueta `ACTIVA` |
| recurso no interpretable | contorno discontinuo, canales grises, sin porcentaje |
| uso de variables sin semántica | segmento neutro y «+ uso sin representación» en el texto |

La escena funciona en escala de grises: los tonos de producto difieren en luminosidad, y
«activa» se lee por la tapa y la etiqueta, no por el color.

```text
             Capacidad de máquina   Mano de obra   Empaque
             100/100 · ACTIVA       80/80 · ACTIVA 60/100 · holgura 40
               ▄▄▄▄                   ▄▄▄▄
               ▓▓▒▒  ← B 20           ▒▒▒▒  ← B 40     ┌──┐
               ▓▓▓▓  ← A 80           ▓▓▓▓  ← A 40     │▒▒│ ← B 20
             ──┴──┴──               ──┴──┴──           │▓▓│ ← A 40
                ╲ 2   1 ╲             ╱ 1   2 ╲       ──┴──┴──
                 ╲        ╲         ╱           ╲     ╱ 1    1
             ███  Producto A · 40         ▒▒  Producto B · 20
```

## 7. Cámara

- Perspectiva, FOV 30°, objetivo fijo en el centro del suelo, polar ≈ 56° y azimut ≈ 32°.
- `OrbitControls` sin pan ni damping. Polar limitado a [20°, 72°], así que nunca se ve bajo el
  suelo. Azimut limitado a [−29°, 83°]. Distancia entre ×0,6 y ×1,6 de la distancia de encuadre.
- Encuadre: esfera envolvente del suelo, ajustada al FOV más estrecho y reducida por `FRAMING = 0,68`
  porque la esfera es holgada para un suelo visto desde arriba.
- «Restablecer vista» vuelve al encuadre inicial.
- Con puntero táctil (`pointer: coarse`), un dedo desplaza la página (`touch-action: pan-y`) y dos
  dedos orbitan y hacen zoom.
- `frameloop="demand"`: solo se renderiza cuando cambia la cámara, los datos o una transición.
- El puntero se calcula con `clientX/Y` y el rectángulo del canvas, no con `offsetX`, porque algunos
  navegadores embebidos o emulados lo reportan desplazado.
- Los contornos no participan en el raycast: el umbral por defecto de `three` para líneas (1 unidad
  de mundo) los convertía en blancos enormes.

## 8. Lifecycle y estados

| Estado | Sistema (`definition`) | Solución |
| --- | --- | --- |
| Sin resolver | completo | «Sistema definido por el modelo · sin resolver» |
| Resolviendo | completo | «Resolviendo con HiGHS…» |
| Óptimo vigente | completo | cantidades, segmentos, tapas, `Z` |
| **Obsoleto** | completo y ya editado | ninguna; «El modelo cambió…» y **Resolver nuevamente** |
| Infactible / no acotado | completo | ninguna; mensaje contextual |
| Error del solver | completo | ninguna; mensaje y nota técnica |
| Error de petición (422/red) | completo | ninguna (el panel de resultados muestra el error) |

**Obsolescencia:** el adapter acepta la solución solo si `solved.model === model`, el mismo criterio
de identidad que `Sandbox`. Toda edición crea un modelo nuevo, también el renombrado. Un resultado
anterior no aporta cantidades, utilización, segmentos ni estado activo. El sistema sí refleja la
edición al instante: una capacidad 100 → 120 se ve como `capacidad 120` antes de resolver.

**Cambio de modelo:** el panel se monta con `key` por workspace. Cambiar a otro template o a Blank
desmonta la escena y su contexto WebGL. Blank Model no tiene escenario, así que solo ofrece
Geometría.

**Preferencia de vista:** Geometría es la vista inicial porque existe para todo modelo de dos
variables y conserva el comportamiento de M3/M4. La elección se recuerda durante la sesión: si se
elige Escenario, al volver a un template con escenario se abre Escenario. No hay persistencia.

## 9. Entidades sin semántica

- Una variable o restricción sin binding no aparece como producto ni recurso. Se informa con
  «N entidad(es) del modelo no tiene(n) representación en este escenario».
- Si una variable sin semántica aparece en un recurso, el recurso lo indica («+ uso sin
  representación»). Su uso `a·x` se dibuja como segmento neutro y cuenta en la descomposición.
- Los ids reutilizados no heredan roles gracias a la poda de M4 (D14).
- Si nada tiene representación, la vista lo dice y no monta WebGL.

## 10. Interacción y sincronización con el editor

`Sandbox` comparte un único `Highlight { constraintId, variableId }` de presentación:

| Hover / foco | Highlight | Efecto en el editor | Efecto en la escena |
| --- | --- | --- | --- |
| recipiente o fila de recurso | `{c, null}` | restricción resaltada | pedestal y canales del recurso |
| estación o fila de producto | `{null, v}` | todos los términos de `v` y su variable en Dominio | estación y sus canales |
| canal o relación del texto | `{c, v}` | **el término exacto** en esa restricción | ese canal |
| restricción en el editor | `{c, null}` | — | recurso resaltado |
| término en el editor | `{c, v}` | — | ese canal |

La Geometric View sigue usando solo `constraintId`. Debajo del canvas, una leyenda textual del
sistema (recursos, relaciones, productos y estado de la solución) es explorable con teclado y
mantiene el escenario legible sin WebGL. La línea de explicación describe el elemento resaltado, por
ejemplo: «Producto A usa 2 de Capacidad de máquina por unidad. Límite teórico impuesto por este
recurso: 50 unidades.»

## 11. SSR, WebGL y errores

- `ProductMixCanvas` se carga con `next/dynamic(..., { ssr: false })` desde un Client Component. El
  resto de la aplicación conserva su render habitual.
- `supportsWebGL()` se consulta con `useSyncExternalStore`, con snapshot de servidor `null`: en SSR
  e hidratación se muestra «Preparando la vista 3D…» sin tocar `window`, `document` ni WebGL.
- Sin WebGL, un error de render, un chunk que no carga (`SceneErrorBoundary`) o la pérdida de
  contexto (`webglcontextlost`) muestran: «No se pudo iniciar la vista 3D. La vista geométrica y el
  modelo siguen disponibles.» El editor, el solver, la geometría y la leyenda textual siguen
  funcionando.

## 12. Animación y rendimiento

- Las barras (columnas y segmentos) se acercan a su nuevo valor con una interpolación exponencial
  corta. Solo piden frames mientras se mueven. Con `prefers-reduced-motion` saltan directamente.
- Sin cintas, partículas ni movimiento permanente.
- Geometrías unitarias compartidas (`UNIT_BOX`, `UNIT_EDGES`) escaladas por objeto, con
  `dispose={null}`. Una escena típica tiene unas 40 mallas.
- Los cálculos derivados se hacen con `useMemo` fuera del bucle. `useFrame` solo proyecta etiquetas
  e interpola barras.

## 13. Testing

- `lib/product-mix-scene.test.ts` (38 tests):
  - sistema antes de resolver, capacidades desde el RHS y consumos desde coeficientes;
  - límites teóricos por recurso y coeficiente objetivo neutral (minimización y negativos);
  - edición inmediata de una relación y las cuatro condiciones de interpretabilidad;
  - capacidad cero sin `Infinity`;
  - solución vigente: 40/20, 2200, utilización 1/1/0,6 y descomposición `a·x` que suma la actividad;
  - discrepancia detectada sin ajustar los datos;
  - uso por variables sin semántica;
  - resultado obsoleto, también con un modelo estructuralmente igual;
  - producto o restricción eliminados, entidades sin binding y renombrado;
  - normalización de valores grandes y de ceros;
  - infactible, no acotado y error;
  - layout acotado y finito.
- `components/scenario-view.test.tsx` (23 tests), con el canvas WebGL sustituido por un doble que
  expone el layout recibido:
  - tabs según escenario, alternancia sin perder el modelo y navegación con flechas;
  - sistema antes de resolver, edición inmediata de relaciones, renombrado y entidades sin
    semántica;
  - solución vigente, invalidación al editar y nueva resolución;
  - infactible y no acotado;
  - hover editor ↔ escena a nivel de restricción y de término;
  - desmontaje al cambiar de modelo y preferencia de vista;
  - fallo del renderer, WebGL no disponible y SSR sin WebGL.

### Verificación manual (Chromium, FastAPI + HiGHS reales)

1. Product Mix sin resolver: tres recipientes con su capacidad, seis canales con coeficientes y dos
   productos con su aporte a Z.
2. Resolver → `A = 40`, `B = 20`, `Z = 2200`:
   - Máquina `100/100 · 100 %` con tapa: segmentos 80 + 20;
   - Mano de obra `80/80 · 100 %` con tapa: segmentos 40 + 40;
   - Empaque `60/100 · 60 %` con holgura 40 y sin tapa.
3. Capacidad de máquina `100 → 120`: la escena muestra `capacidad 120` y desaparecen columnas,
   rellenos y tapas. «Resolver nuevamente» desde la escena → `A = 53,3333`, `B = 13,3333`,
   `Z = 2533,3333`; Máquina `120 = 106,6667 + 13,3333`.
4. Hover de cada uno de los 11 objetos de la escena:
   - los recursos resaltan su restricción en el editor;
   - los productos resaltan todos sus términos;
   - cada canal resalta su término exacto.
5. Renombrar Producto A → «Mesas»: la etiqueta cambia y el binding se conserva.
6. Eliminar Producto B: desaparecen su estación y sus canales.
7. Añadir una variable (reutiliza `x2`): nace sin semántica y aparece el aviso «1 entidad…».
8. Empaque `≤ → ≥`: «no interpretable como capacidad». Resolver → infactible: el sistema sigue
   visible y no hay cantidades.
9. Blank Model: solo Geometría y canvas desmontado. Volver a Product Mix: Escenario recordado y
   sistema limpio.
10. Móvil 375 px: sin scroll horizontal, `touch-action: pan-y` y etiquetas compactas.

## 14. Limitaciones

- Un solo escenario 3D (Product Mix) y dos roles. No hay editor de bindings ni escenas para otros
  templates.
- No hay unidades: las etiquetas no dicen «horas» ni «piezas», porque el escenario no las define.
- El objetivo no tiene semántica propia: se muestra como coeficiente («aporte a Z por unidad»).
- Las cotas superiores de los productos no se dibujan.
- No hay orden de proceso: el sistema es bipartito porque el modelo no contiene secuencia.
- Con muchas entidades, las filas se alargan y las etiquetas pueden solaparse. En lienzos estrechos
  se compactan y la leyenda textual conserva todos los valores.
- No hay tests de render WebGL real: la geometría de la escena se verifica en la capa pura y
  manualmente en navegador.

## 15. Cómo continuar M5

### Arranque local

Dos terminales, igual que en el README:

```powershell
# backend (puerto 8000)
cd solver
.\.venv\Scripts\python.exe -m uvicorn optimization_sandbox.api:app --reload --port 8000

# frontend (puerto 3000)
cd web
npm run dev
```

Los puertos importan: CORS del backend solo admite `localhost:3000` / `127.0.0.1:3000` por defecto
y el frontend llama a `127.0.0.1:8000` salvo que se defina `NEXT_PUBLIC_SOLVER_URL`.

### Dónde tocar cada cosa

| Cambio | Archivo | Revisar también |
| --- | --- | --- |
| Qué entidades y relaciones se leen del modelo, reglas de un rol | `lib/product-mix-scene.ts` → `buildDefinition` | `product-mix-scene.test.ts`, §3 y `SCENARIOS.md` §9 |
| Estado de la solución, obsolescencia, `a·x`, tolerancia | `lib/product-mix-scene.ts` → `buildSolution`, `DECOMPOSITION_TOLERANCE` | §4, `ARCHITECTURE.md` D17 |
| Escalas visuales (alturas, anchos, separación de filas) | `lib/product-mix-layout.ts` → `FLOOR` | tests de layout, §5 |
| Colores de productos y escena | `components/scenario/tones.ts` | legibilidad en escala de grises |
| Forma de pedestales, recipientes, tapas y canales | `components/scenario/product-mix-canvas.tsx` (`PLINTH_HEIGHT`, `VESSEL_WIDTH`, `ResourceStation`, `ProductStation`, `Channel`) | §6 |
| Cámara, encuadre y límites de órbita | `product-mix-canvas.tsx` (`CAMERA_*`, `TARGET_HEIGHT`, `FRAMING`, `CameraRig`) | §7 |
| Texto de etiquetas 3D | `product-mix-view.tsx` → `sceneLabels` | CSS `.scene-label*` en `app/globals.css` |
| Posición de etiquetas | `product-mix-canvas.tsx` → `LabelProjector` | — |
| Mensajes de estado, explicación del hover, leyenda textual | `product-mix-view.tsx` (`SolutionStatus`, `describeHighlight`, `SystemReadout`, `ISSUE_COPY`) | `scenario-view.test.tsx` |
| Tabs, vista inicial y preferencia de sesión | `components/sandbox.tsx` (`preferredView`) y `components/visualization-panel.tsx` | §8 |
| Resaltado compartido editor ↔ vistas | `lib/highlight.ts`, `components/model-editor.tsx` | §10 |
| Detección de WebGL y fallback | `lib/webgl.ts`, `scene-error-boundary.tsx`, `product-mix-view.tsx` | §11 |

**Nueva vista de escenario:** un adapter puro propio (como `product-mix-scene.ts`), su componente de
vista y **una entrada** en `components/scenario-views.ts`. Ningún otro archivo debe comparar ids de
escenario. Si necesita un rol nuevo, se añade en `lib/scenario.ts` con su regla de lectura documentada
en `SCENARIOS.md`.

### Invariantes que no se deben romper

- `OptimizationModel`, `OptimizationResult`, `ScenarioDefinition`, `/solve` y el backend no conocen
  la escena. Nada visual entra en esos contratos.
- Ningún número de la escena está escrito a mano: todo sale del modelo, del escenario o del
  resultado vigente.
- Un resultado solo cuenta si `solved.model === model`; un resultado obsoleto no aporta nada.
- `activity`, `slack` y `active` vienen del backend; `a·x` solo explica y nunca se ajusta.
- Ninguna magnitud matemática se usa directamente como coordenada: pasa por `FLOOR`.
- El canvas solo se carga en el cliente (`ssr: false`) y sus fallos quedan dentro del error boundary.
- `useFrame` solo proyecta etiquetas o interpola barras; los datos derivados se calculan con
  `useMemo` fuera del bucle.

### Tests

- La lógica nueva va primero a `lib/product-mix-scene.test.ts`, sin React.
- `components/scenario-view.test.tsx` sustituye `product-mix-canvas` con `vi.mock` por un doble que
  expone el `layout`, las `labels` y el `highlight` que recibe, y mockea `supportsWebGL`. Si cambian
  las props del canvas, hay que actualizar el doble. No se intenta render WebGL en jsdom.
- Antes de cerrar un cambio: `pytest`, `npm test` y `npm run build` en verde, más una prueba en
  navegador con el backend real.

### Trampas al verificar en navegador

- Con `frameloop="demand"` la escena solo se dibuja cuando la pestaña es visible. En un navegador
  embebido u oculto el canvas puede parecer vacío y las etiquetas no tener posición hasta que la
  página se muestra.
- Fast Refresh conserva el estado de React y no vuelve a ejecutar el encuadre de la cámara si sus
  dependencias no cambian: tras tocar constantes de cámara, recargar la página.
- Los eventos sintéticos pueden traer `offsetX` erróneo en navegadores embebidos o con emulación de
  viewport. Por eso el puntero se calcula con `clientX/Y`; al automatizar hovers, despachar eventos
  con `clientX/Y` reales.
- Las posiciones proyectadas de las etiquetas (`style.transform` de `.scene-label`) sirven para
  apuntar a cada objeto en pruebas automatizadas: bajo la etiqueta de un recurso está su recipiente y
  la etiqueta de un canal está sobre el canal.
- Cambiar un `<select>` o un `<input>` de React por script exige el setter nativo de `value` y un
  evento `change`/`input`; asignar el valor del DOM no actualiza el modelo.

### Posibles siguientes pasos (no comprometidos)

- Dibujar las cotas superiores de los productos como límite de la columna.
- Unidades opcionales para recursos y productos, si el escenario llega a definirlas.
- Evitar colisiones de etiquetas con muchas entidades.
- Una vista de escenario para un segundo template, para validar el registro con más de una entrada.
