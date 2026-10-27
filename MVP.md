# Optimization Sandbox — MVP

## Objetivo

Construir la versión mínima capaz de demostrar la idea central de Optimization Sandbox

 escribir un modelo lineal, resolverlo y explorar visualmente su solución.

---

# Caso inicial

El MVP utilizará problemas de programación lineal continua con dos variables.

Ejemplo

```text
maximize 40x1 + 30x2

subject to

2x1 + x2 = 100
x1 + 2x2 = 80

x1 = 0
x2 = 0
```

---

# Funcionalidades requeridas

## 1. Model Editor

El usuario puede definir

- función objetivo;
- maximize  minimize;
- restricciones;
- variables.

Inicialmente puede utilizarse una sintaxis simple controlada.

Ejemplo

```text
max 40x1 + 30x2

2x1 + x2 = 100
x1 + 2x2 = 80
x1 = 0
x2 = 0
```

---

## 2. Parser

El sistema convierte la entrada del usuario a una representación interna.

Ejemplo conceptual

```json
{
  objective {
    sense maximize,
    terms {
      x1 40,
      x2 30
    }
  },
  constraints []
}
```

---

## 3. Solver

El modelo interno se envía a un solver de programación lineal.

El resultado debe contener al menos

- status;
- objective value;
- valores de variables;
- slack de restricciones.

---

## 4. Results Panel

Mostrar

```text
Optimal solution

x1 = ...
x2 = ...

Objective = ...
```

También

- restricciones activas;
- slack;
- recursos utilizados.

---

## 5. Geometric Visualization

Para modelos con dos variables

- dibujar restricciones;
- mostrar región factible;
- mostrar punto óptimo.

La visualización debe actualizarse cuando cambia el modelo.

---

## 6. Parameter Experimentation

El usuario puede cambiar coeficientes o límites y resolver nuevamente.

Ejemplo

```text
2x1 + x2 = 100
```

cambia a

```text
2x1 + x2 = 140
```

El gráfico y la solución deben actualizarse.

---

# Primera demo oficial

La primera demo debe permitir

1. abrir Product Mix;
2. observar el modelo;
3. resolverlo;
4. observar región factible;
5. observar solución óptima;
6. cambiar capacidad de una máquina;
7. resolver nuevamente;
8. ver cómo cambia la solución.

Si esto funciona correctamente, el MVP está terminado.

---

# Fuera del MVP

No implementar todavía

- MILP;
- variables binarias;
- variables enteras;
- scheduling;
- warehouse 3D;
- transportation 3D;
- editor visual avanzado;
- colaboración;
- cuentas de usuario;
- guardar proyectos en cloud;
- IA generadora de modelos;
- solver propio;
- animaciones complejas;
- modelos no lineales.

Estas funcionalidades pertenecen a versiones posteriores.