# Diseño — Pantalla de Inicio: resumen de hoy

**Fecha:** 2026-06-27
**Pantalla:** Inicio (`screen === 'inicio'`)
**Objetivo:** Reemplazar el Inicio actual (cards de turno + actividad reciente) por un **resumen de hoy** orientado al cajero, con vista ampliada para el administrador.

## Contexto

El Inicio actual (`src/index.html`, markup en líneas ~229–283) muestra 4 cards de turno
(Ventas del turno, Total vendido, Tiempo en turno, Ticket promedio) reusando `histCount`/`histTotal`
(todas las ventas del día, sin filtro por cajero) y una lista de "Actividad reciente".

Este rediseño lo convierte en un resumen del día con ámbito por rol y un gráfico de horas peak.
Se enmarca dentro del pulido del prototipo previo a definir el esquema Postgres (Vercel); por eso
los campos nuevos de datos se eligen pensando en que alimenten ese esquema más adelante.

## Modelo de datos — campos nuevos

Tres campos nuevos. Los tres son necesarios para las métricas y reutilizables en el esquema Postgres.

1. **`sale.cashierId`** — id del cajero que cobró la venta.
   - Las ventas del mock (`src/index.html` ~1557–1579) se siembran repartidas entre los cajeros
     existentes (`u1` Daniela/admin, `u2` M. Jara, `u3` Pedro), de modo que cada cajero tenga varias
     ventas para que su vista no quede vacía en demo.
   - En venta real (`confirmPay`, ~1788): `cashierId = session.id`.

2. **`customer.createdAt`** (fecha) **+ `customer.createdBy`** (id de cajero) — alta del cliente.
   - Los 4 clientes existentes (~1551–1556): la mayoría con fecha anterior; **1–2 sembrados como
     dados de alta "hoy"** y atribuidos a un cajero, para que la métrica no sea cero en demo.
   - En registro real (`phoneRegister`, ~1753): `createdAt = hoy`, `createdBy = session.id`
     (así la métrica sube en vivo durante una demo).

3. **`product.minStock`** — mínimo de reposición por producto.
   - Se agrega al factory `P(...)` (~1434) y a cada producto del catálogo (~1526–1550).
   - "Stock bajo" se define como **`stock <= minStock`**.
   - Los mínimos se siembran de modo que ~3–5 productos queden bajo el umbral (lista no vacía).

## Lógica de ámbito por rol

`isAdmin = role === 'admin' || role === 'kromi'` (ya existe, ~1971).

Se define el conjunto de ventas según rol:

```
scopeSales = isAdmin ? S.sales : S.sales.filter(s => s.cashierId === session.id)
```

- **Cajero** → solo lo suyo. Header: eyebrow `{todayStr} · Sucursal Centro`, título **"Tu turno de hoy"**.
- **Administrador** → toda la tienda. Header título **"Resumen de hoy · toda la tienda"**.

## Métricas (definición exacta)

Todas calculadas en el bloque de estado derivado (junto a `histCount`/`histTotal`, ~2129).

| Métrica | Cálculo |
|---|---|
| **Cantidad de ventas** | `scopeSales.length` |
| **Total vendido** | `sum(scopeSales.map(s => s.total))`, formateado con `fmt()` |
| **Nuevos clientes registrados** | `customers` con `createdAt` = hoy **y** (`isAdmin` o `createdBy === session.id`) |
| **Clientes que compraron sin registrarse** | `scopeSales.filter(s => s.customerId === null).length` |

Nota sobre "hoy": el prototipo opera sobre un día de demo fijo (`todayStr = 'Lun 23 jun 2026'`).
Se define una constante de fecha "hoy" de demo; `createdAt` se compara contra ella. Los registros
hechos en vivo usan la fecha real del sistema, por lo que también cuentan como "hoy".

## Layout

Reemplaza por completo las 4 cards actuales y elimina "Actividad reciente".

### Stat cards (4) — ambos roles, cambia solo el dato según ámbito
1. **Cantidad de ventas** — card oscura destacada (estilo de la card hero actual `#0F2A1B`).
2. **Total vendido** — `$`, "IVA incluido".
3. **Nuevos clientes registrados** — conteo del día.
4. **Clientes que compraron sin registrarse** — conteo de ventas sin cliente.

Grid de 4 columnas, degradando en ventanas angostas (mismo patrón que el grid actual).

### Gráfico "Ventas por hora" (barras)
- **Barras verticales**, una por hora del día operativo (09–19 h), altura proporcional a la
  **cantidad de ventas** en esa hora.
- Datos: `buckets[h] = count de scopeSales en la hora h` (reusa la lógica de `buckets`, ~2154–2158,
  pero **scopeada** y orientada a conteo, no a importe).
- La **hora pico** (mayor conteo) se resalta en verde de acento; el resto en tono apagado.
- Badge "Hora pico HH–HH h" (reusa `peakLabel`).
- Implementación: divs con flexbox e inline styles (sin librería de gráficos — restricción del
  proyecto: frontend estático autocontenido, offline). Eje X con etiquetas de hora.

### Bloque "Stock bajo" — solo administrador
- Visible solo si `isAdmin`.
- Lista de productos con `stock <= minStock`, ordenados por más crítico primero
  (`stock - minStock` ascendente, o `stock` ascendente).
- Cada fila: nombre, categoría, **stock actual vs mínimo**, indicador de color.
- Link/botón "Ir a Stock" (reusa `goStock`).
- Estado vacío: mensaje "Sin productos bajo el mínimo" si la lista está vacía.

## Qué se elimina

- Cards "Tiempo en turno" y "Ticket promedio".
- Sección "Actividad reciente" completa (markup ~266–280).
- Valores de estado derivado que queden sin uso tras esto (`recentActivity`, `shiftDurationStr`,
  `shiftOpenStr`, `myShiftAvgStr`, y `myShiftCount`/`myShiftTotalStr` si se renombran). Verificar que
  no se usen en otra pantalla antes de borrarlos.

## Consideraciones técnicas

- Frontend estático autocontenido (`src/index.html`), React vendorizado, inline styles. **Sin
  dependencias nuevas** ni librerías de gráficos.
- El gráfico de barras y el bloque de stock bajo siguen el idioma de componentes existente
  (divs con estilos inline, helpers `fmt()`).
- Trazabilidad: cambios atribuibles a este diseño y al contrato `.kromi/init.md` (resumen del cajero).

## Criterios de aceptación

1. Como **cajero**, Inicio muestra mis 4 métricas del día (ventas, total, nuevos registrados por mí,
   sin registrar) calculadas solo sobre **mis** ventas, y el gráfico con **mis** ventas por hora.
2. Como **administrador**, las mismas 4 métricas pero sobre **toda la tienda**, el gráfico con todas
   las ventas, y **además** el bloque "Stock bajo" con los productos bajo su mínimo.
3. El gráfico de barras muestra la cantidad de ventas por hora y resalta la hora pico.
4. Las cards de "Tiempo en turno"/"Ticket promedio" y la "Actividad reciente" ya no aparecen.
5. Una venta nueva (y un registro de cliente nuevo) hechos en la sesión se reflejan en las métricas.

## Fuera de alcance

- Persistencia (irá a Postgres/Vercel en una etapa posterior).
- Filtros de período en Inicio (el selector Día/Semana/Mes/Año vive en Historial).
- Edición del `minStock` desde la UI (se siembra; la edición puede sumarse al pulir Stock).
- Acentos en impresión y demás pendientes ya registrados.
