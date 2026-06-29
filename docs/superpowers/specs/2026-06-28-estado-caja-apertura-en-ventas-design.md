# Diseño — Estado de caja (apertura/cierre) en el módulo Venta

**Fecha:** 2026-06-28
**Pantallas:** Venta (`screen === 'venta'`) y Cierre de caja (`screen === 'cierre'`)
**Objetivo:** Introducir un ciclo de vida real de **sesión de caja** (`cerrada → abierta → cerrada`) que condicione el módulo Venta, y definir el proceso de reapertura como una sesión nueva auditable.

## Contexto

- `src/index.html`. Hoy **no existe** un estado real de caja: está implícitamente "abierta" apenas hay sesión iniciada (`showCaja: !!S.session`).
- `cierreOpenTime` está hardcodeado en `'09:00'`; el fondo `cierreFloat` es fijo en `$50.000` (no hay acción de *abrir caja* que los defina).
- `cierreDone` solo marca que ya se hizo el arqueo; "Iniciar nuevo turno" (`resetCierre`) borra esa marca.
- El arqueo (pantalla Cierre y `doCierre`) se calcula sobre **todas** las ventas del cajero logueado (`s.cashierId === session.id`), no por sesión.
- `cierres` es una lista de registros (cada cierre es una fila), ya existe `sale.cashierId`.

## Definición de proceso (estándar retail)

Concepto de **sesión de caja**: `apertura → ventas → arqueo/cierre`. Regla de auditoría:

> **Un cierre sella la sesión. No se reabre una sesión ya cerrada — se abre una sesión nueva.**

Escenario del cliente que llega tras el cierre: se **abre caja de nuevo** y luego se **cierra de nuevo**, generando un **segundo registro de cierre independiente** (segunda sesión). No se edita el cierre anterior.

## Decisiones de alcance

- **Apertura:** solo confirmar, con fondo fijo $50.000 (no se pide monto inicial editable).
- **Arqueo:** cuenta **solo las ventas de la sesión actual** (las hechas desde la última apertura).
- Caja **arranca cerrada**; el cajero debe abrir antes de vender.

## Modelo de estado

| Estado nuevo | Inicial | Significado |
|---|---|---|
| `cajaOpen` | `false` | Caja abierta/cerrada. Arranca cerrada. |
| `cajaOpenAt` | `null` | Hora real de apertura (label `HH:MM`); reemplaza el `'09:00'` hardcodeado. |
| `cajaSessionId` | `0` | Contador; **incrementa en cada apertura**. Identifica la sesión. |

Cada venta creada en `confirmPay` se sella con `sale.cajaSessionId = S.cajaSessionId` (valor vigente al confirmar el pago).

## Flujo / transiciones

```
   [CERRADA] ──"Abrir caja"──▶ [ABIERTA] ──"Cerrar caja" (arqueo)──▶ [CERRADA]
      ▲                                                                  │
      └──────────── reapertura crea NUEVA sesión (nuevo cierre) ─────────┘
```

- **`abrirCaja()`** (nuevo handler): `cajaOpen=true`, `cajaOpenAt=` hora actual `HH:MM`, `cajaSessionId++`, limpia `cierreDone` y `cierreCounted`. Empieza sesión fresca con fondo fijo.
- **`doCierre()`** (reescrito):
  - Filtra ventas por la sesión actual: `x.cajaSessionId === s.cajaSessionId` (en vez de todas las del cajero).
  - `openTime = s.cajaOpenAt` real (en vez de `'09:00'`).
  - Graba el registro en `cierres`, pone `cajaOpen=false`, marca `cierreDone=true` y **limpia el carrito** (`cart: []`) para no dejar uno colgado.
- **`resetCierre`** se elimina; su rol ("reabrir") lo cubre `abrirCaja`.

## Pantalla Venta — bloqueo por estado de caja

El contenido de Venta (envuelto hoy en `sc-if value="{{ isVenta }}"`) se condiciona además por `cajaOpen`:

- **Caja abierta** → flujo de venta normal (idéntico a hoy: catálogo/escáner, carrito, pago).
- **Caja cerrada** → panel centrado: ícono + *"La caja está cerrada"*, subtítulo *"Abre la caja para comenzar a registrar ventas"* y botón verde **"Abrir caja"** (`abrirCaja`). Sin catálogo ni carrito.

Se exponen flags de vista: `cajaOpen`, y el contenido cerrado como bloque alternativo dentro de la pantalla Venta.

## Pantalla Cierre de caja — 3 estados

Reemplaza el dúo actual "Cerrar caja / Iniciar nuevo turno":

1. **Abierta** (`cajaOpen`) → arqueo en vivo de la **sesión actual** + botón **"Cerrar caja"** (`doCierre`).
2. **Recién cerrada** (`!cajaOpen && cierreDone`) → resumen del arqueo recién hecho (solo lectura) + nota *"Caja cerrada. Para atender otra venta, abre caja nuevamente."* con botón **"Abrir caja"**.
3. **Cerrada sin sesión previa** (`!cajaOpen && !cierreDone`) → mensaje *"No hay una caja abierta"* + botón **"Abrir caja"**.

El arqueo en vivo (`cierreMine`) pasa a filtrar por `s.cajaSessionId === S.cajaSessionId`; el `openTime` mostrado usa `cajaOpenAt`.

## Historial de cierres (admin)

Sin cambios. Cada reapertura ya produce su propio registro en `cierres`, por lo que el historial refleja correctamente múltiples turnos en un mismo día.

## Criterios de aceptación

1. Al iniciar sesión, el módulo Venta muestra el panel "Caja cerrada" con botón "Abrir caja"; no se puede agregar al carrito.
2. "Abrir caja" abre la sesión (registra hora real, incrementa `cajaSessionId`) y habilita el flujo de venta normal.
3. "Cerrar caja" en Cierre graba un registro en `cierres` con la hora de apertura real y **solo las ventas de la sesión actual**, cierra la caja y limpia el carrito.
4. Tras cerrar, Venta vuelve a "Caja cerrada"; al abrir de nuevo se crea una **segunda sesión** y un segundo cierre independiente (no edita el anterior).
5. El historial de cierres (admin) lista cada sesión como una fila separada.

## Fuera de alcance

- Fondo de apertura configurable (sigue fijo en $50.000).
- Persistencia (Postgres en etapa posterior).
- Multi-cajero simultáneo en el mismo dispositivo.
- Bloqueo por rol del botón "Abrir caja" (cualquier sesión con acceso a Venta puede abrir).
