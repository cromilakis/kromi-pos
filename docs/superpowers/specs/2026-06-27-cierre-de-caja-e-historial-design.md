# Diseño — Cierre de caja + historial de cierres

**Fecha:** 2026-06-27
**Pantallas:** Cierre de caja (`screen === 'cierre'`) + sección nueva en Historial (`screen === 'historial'`, admin)
**Objetivo:** Hacer el arqueo de caja absolutamente claro (con % de desvío) y agregar un historial de cierres para que el admin vea quién trabajó y cómo cerró cada turno.

## Contexto

- `src/index.html`. Hoy `doCierre` solo hace `cierreDone: true`: **no persiste nada**, no hay historial.
- El arqueo se calcula sobre **todas** las ventas (`S.sales`), no por cajero. Fondo fijo `cierreFloat = 50000`.
- Ya existe `sale.cashierId`, así que el cierre puede ser por cajero.
- Historial es **solo admin** (se entra por el menú de administración).

## Decisión de alcance

- El cierre/historial es una **función administrativa**. El cajero realiza su arqueo pero **no ve historial**.
- El historial de cierres vive **dentro de la pantalla Historial** (admin).
- El % de desvío se calcula **sobre lo esperado en caja**: `diff / (fondo + ventas efectivo)`.

## Modelo de datos

Nuevo array de estado **`cierres`**, sembrado con ~6 cierres históricos (distintos cajeros y días; casos exacto / sobrante / faltante con % variados).

Registro almacenado (campos crudos; lo derivado se calcula al mostrar):
```
{ id, dateIso, dateLabel, cashierId, cashierName, openTime, closeTime,
  salesCount, cash, card, float, counted }
```
Derivados al mostrar: `total = cash + card`, `expected = float + cash`, `diff = counted - expected`, `pct = expected ? diff/expected*100 : 0`.

## Arqueo actual (pantalla Cierre) — más claro y por cajero

- Se calcula sobre las ventas del **cajero logueado** (`s.cashierId === session.id`): total del turno, efectivo, tarjeta, n° de ventas, ticket promedio.
- Bloque de arqueo: fondo de apertura, ventas en efectivo, **esperado en caja**, efectivo contado, y **diferencia con monto + % + etiqueta**:
  - `Caja cuadrada (exacto)` (verde) cuando diff = 0.
  - `Sobrante · +X,X%` (azul) cuando diff > 0.
  - `Faltante · X,X%` (rojo) cuando diff < 0.
- Botón **"Cerrar caja"**: agrega un registro a `cierres` con quién, hora de cierre, montos, diferencia y %; marca `cierreDone`.
- "Iniciar nuevo turno" (resetCierre) limpia el arqueo para un nuevo cierre.

## Historial de cierres (Historial, admin)

Nueva sección **"Cierres de caja"** debajo del listado de ventas:
- **Mini-resumen** (3 tarjetas): cantidad de cierres, cuántos cuadraron exactos, y faltante/sobrante neto acumulado.
- **Tabla** ordenada por fecha desc: `fecha · cajero · esperado · contado · diferencia · % · estado`.
  - **% con color** y signo.
  - **Chip de estado**: Exacto (verde) / Sobrante (azul) / Faltante (rojo).

## Estado / handlers

- Estado: `cierres` (array sembrado).
- `doCierre` reescrito: construye el registro desde el arqueo actual y lo agrega a `cierres`, set `cierreDone`.
- Helper de formato de %: `pctStr(p)` → `'2,3%'` (1 decimal, coma decimal es-CL).

## Criterios de aceptación

1. El arqueo actual muestra los montos del cajero logueado y la diferencia con **monto + % + etiqueta de color**.
2. "Cerrar caja" agrega un cierre al historial con el cajero, la hora, los montos y el %.
3. En Historial (admin), la sección "Cierres de caja" lista todos los cierres con cajero, montos, % de color y chip de estado, más un mini-resumen.
4. El % se calcula sobre lo esperado en caja; "Exacto" cuando la diferencia es 0.

## Fuera de alcance

- Fondo de apertura configurable (sigue fijo en $50.000).
- Persistencia (Postgres en etapa posterior).
- Bloqueo estricto del turno tras cerrar (en el prototipo, "Iniciar nuevo turno" reabre el arqueo).
