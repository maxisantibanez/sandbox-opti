# Optimization Sandbox — Vision

## Idea

Optimization Sandbox es una herramienta open source para crear, resolver y visualizar modelos de optimización matemática de forma interactiva.

El usuario trabaja directamente con conceptos como:

- variables de decisión;
- función objetivo;
- restricciones;
- parámetros;
- solución óptima;
- región factible;
- utilización de recursos;
- holguras.

La aplicación transforma esos modelos matemáticos en representaciones visuales que ayudan a entender qué está ocurriendo.

---

## Ejemplo básico

Un usuario puede definir:

```text
maximize 40*x1 + 30*x2

subject to

2*x1 + x2 <= 100
x1 + 2*x2 <= 80

x1 >= 0
x2 >= 0
```
## Construcción interactiva del modelo

Aunque la matemática es el núcleo de Optimization Sandbox, el usuario no debería necesitar aprender un lenguaje de modelado como AMPL ni escribir manualmente un modelo completo utilizando sintaxis específica.

La construcción del modelo debe ser **visual, guiada e interactiva**.

La experiencia debería ser similar a herramientas matemáticas como GeoGebra: el usuario trabaja directamente con variables, coeficientes, operadores y restricciones, pero la interfaz lo guía durante todo el proceso.

Por ejemplo, en lugar de exigir que el usuario escriba:

```text
maximize 40*x1 + 30*x2

subject to

2*x1 + x2 <= 100
x1 + 2*x2 <= 80

x1 >= 0
x2 >= 0
```

la interfaz podría permitir construir el mismo modelo progresivamente.

### Función objetivo

```text
Objetivo

[ Maximizar ▼ ]

[ 40 ] · [ x₁ ▼ ]  [ + ]  [ 30 ] · [ x₂ ▼ ]

[ + término ]
```

Visualmente, el sistema puede representar el resultado como:

```text
Max Z = 40x₁ + 30x₂
```

### Restricciones

```text
Restricción 1

[ 2 ] · [ x₁ ▼ ]  [ + ]  [ 1 ] · [ x₂ ▼ ]

[ ≤ ▼ ]

[ 100 ]
```

que representa:

```text
2x₁ + x₂ ≤ 100
```

El usuario puede agregar nuevas restricciones mediante:

```text
[ + Agregar restricción ]
```

### Variables

Las variables también deben poder definirse desde la interfaz:

```text
Variable

Nombre
[ x₁ ]

Descripción
[ Producto A ]

Dominio
[ Continua ▼ ]

Límite inferior
[ 0 ]

Límite superior
[ ∞ ]
```

La interfaz debe encargarse de transformar estas acciones en la representación matemática interna utilizada por el solver.

---

## Principio UX

El usuario debe sentir que está **construyendo matemáticas**, no programándolas.

La aplicación debe:

- mostrar continuamente la expresión matemática resultante;
- prevenir sintaxis inválida siempre que sea posible;
- ofrecer operadores y variables mediante controles visuales;
- permitir agregar, eliminar y reordenar términos;
- permitir modificar coeficientes directamente;
- actualizar las visualizaciones conforme cambia el modelo;
- explicar errores matemáticos de forma comprensible.

El usuario debe poder concentrarse en el problema de optimización y no en aprender la sintaxis de una herramienta.

---

## Representación interna

La interfaz visual es solamente una forma de construir el modelo.

Internamente, toda interacción debe producir una representación estructurada común:

```text
UI interactiva
      │
      ▼
OptimizationModel
      │
      ├── Solver
      ├── Mathematical View
      ├── Geometric View
      └── Scenario View
```

De esta forma, la interfaz puede evolucionar sin cambiar la forma en que el resto del sistema interpreta los modelos.


El sistema debe ser capaz de:

1. interpretar el modelo;
2. validarlo;
3. resolverlo;
4. mostrar la solución;
5. visualizar la región factible cuando sea posible;
6. explicar qué restricciones están activas;
7. permitir modificar parámetros y resolver nuevamente.

---

# Principio central

La matemática es el núcleo del producto.

Las visualizaciones son representaciones del modelo matemático.

No se construye una simulación 3D a la cual posteriormente se le agregan ecuaciones.

Se construye un modelo matemático que puede tener distintas representaciones visuales.

---

# Formas de visualización

Un modelo puede tener diferentes niveles de representación.

## Mathematical View

Disponible para todos los modelos.

Muestra:

- función objetivo;
- restricciones;
- variables;
- solución;
- valor objetivo;
- slack;
- restricciones activas.

## Geometric View

Disponible cuando la dimensión lo permite.

Dos variables:

- región factible 2D;
- restricciones;
- punto óptimo.

Tres variables:

- región factible 3D;
- planos;
- punto óptimo.

## Scenario View

Disponible para modelos que poseen información semántica adicional.

Ejemplos:

- Production Line;
- Warehouse;
- Transportation;
- Resource Allocation;
- Scheduling.

Estas escenas no reemplazan al modelo matemático.

Son otra forma de observar su solución.

---

# Templates

El usuario puede:

## Crear un modelo desde cero

Blank Model.

El usuario define sus propias variables, objetivo y restricciones.

## Utilizar un template

Ejemplos:

- Product Mix;
- Warehouse Allocation;
- Transportation Problem;
- Diet Problem;
- Workforce Scheduling.

Un template contiene:

- modelo matemático inicial;
- descripción educativa;
- nombres semánticos de variables;
- parámetros editables;
- representación visual opcional.

---

# Experimentación

Optimization Sandbox no debe ser únicamente un botón "Solve".

El usuario debe poder experimentar.

Por ejemplo:

```text
Machine capacity

100 → 150
```

y observar cómo cambia:

- la región factible;
- la solución óptima;
- el valor objetivo;
- la utilización de recursos;
- la escena visual.

---

# Manual vs Optimal

El usuario podrá eventualmente introducir manualmente valores para las variables.

Ejemplo:

```text
x1 = 30
x2 = 40
```

El sistema debe indicar:

- si la solución es factible;
- qué restricciones viola;
- valor de la función objetivo;
- diferencia respecto del óptimo.

Esto convierte al proyecto en una herramienta para explorar optimización, no solamente resolver problemas.

---

# Público objetivo

Principalmente:

- estudiantes;
- docentes;
- personas aprendiendo investigación de operaciones;
- desarrolladores interesados en optimización;
- personas que quieran experimentar visualmente con modelos matemáticos.

No pretende competir inicialmente con herramientas profesionales como AMPL, Gurobi Studio o software industrial de simulación.

---

# Lo que NO es

Optimization Sandbox no es:

- un simulador industrial completo;
- un CAD;
- un digital twin industrial;
- una herramienta de animación 3D;
- un reemplazo de Python/Pyomo;
- un solver desarrollado desde cero.

Utiliza solvers existentes y concentra su innovación en la interacción, modelado y visualización.

---

# Filosofía

Un usuario debería poder pasar de:

> "No entiendo qué significa esta restricción."

a:

> "Ahora veo exactamente cómo esa restricción limita la solución."

La interfaz debe hacer visible la matemática.