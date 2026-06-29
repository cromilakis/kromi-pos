# Diseño — Detalle de ventas por cierre + filtros + fix ticket historial

**Fecha:** 2026-06-28
**Pantalla:** Historial › pestaña "Cierres de caja" (admin), y modal de ticket de venta.
**Objetivo:** Que desde un cierre se pueda ver el detalle de las ventas de esa jornada, filtrar los cierres por cajero y fecha, y corregir el modal de detalle de venta del historial (botón "Cerrar" + impresión).

## Contexto

- `src/index.html`. Hoy `cierres` guarda **solo agregados** (`salesCount, cash, card, float, counted`); no la lista de ventas.
- Las ventas viven en `S.sales` con `cashierId`; las nuevas además con `cajaSessionId`.
- La pestaña Cierres muestra mini-resumen + tabla no clickeable.
- El modal de ticket (`S.ticket`) se usa post-venta y desde el historial (`openTicket`). Botones actuales: "Imprimir" y "Nueva venta" (esta última equivocada en contexto historial).

## Modelo de datos

Cada registro de `cierres` incluye `sales: [{ folio, time, method, total, lines:[{name,qty,price}] }]`.
- **Históricos sembrados:** helper `MKC(meta, diff, sales)` deriva `cash`/`card`/`salesCount` de `sales` y calcula `counted = float + cash + diff` (float = 50000). `diff` da la variedad exacto/sobrante/faltante.
- **Cierres nuevos (`doCierre`):** capturan `sales: mine.map(x => ({ folio, time, method, total, lines }))`.

## Pestaña Cierres — filtros

Barra sobre la tabla:
- **Cajero:** Todos + cada `cashierName` presente.
- **Fecha:** Todas + cada `dateLabel` (por `dateIso`) presente.
- Estado: `cierreFilterCajero` ('all' | cashierId), `cierreFilterDate` ('all' | dateIso).
- El set filtrado alimenta el mini-resumen (cierres, exactos, diferencia neta) **y** la tabla.
- Cada fila es clickeable → `openCierreDetail(id)`.

## Vista de detalle (pantalla completa)

Cuando `cierreDetailId` está set (y estamos en historial+pestaña cierres), la pestaña reemplaza la lista por el detalle:
- Botón **"← Volver a cierres"** (`closeCierreDetail`).
- Encabezado: cajero · fecha · apertura–cierre.
- Bloque de arqueo: total del turno, efectivo, tarjeta · esperado, contado, diferencia (con color + estado).
- **Tabla de ventas de la jornada:** folio · hora · método (chip) · ítems (resumen) · total.

`closeCierreDetail` y el cambio de pestaña/pantalla limpian `cierreDetailId`.

## Fix modal de ticket (detalle de venta)

- Nuevo flag `ticketFromHistory`: `openTicket` lo pone `true`; `confirmPay` lo pone `false`.
- El botón secundario muestra **"Cerrar"** cuando `ticketFromHistory`, **"Nueva venta"** si viene de una venta recién hecha. Ambos llaman `closeTicket`.
- El botón "Imprimir" se mantiene (ya invoca `print_receipt`; `buildReceiptPayload` ya tiene fallback `recFecha||date`, por lo que imprime también ventas históricas).

## Criterios de aceptación

1. Cada cierre (sembrado o nuevo) tiene su lista de ventas; los agregados de los sembrados se derivan de ella.
2. La pestaña Cierres permite filtrar por cajero y por fecha; resumen y tabla reflejan el filtro.
3. Al hacer clic en un cierre se abre una vista de detalle a pantalla completa con el arqueo y la tabla de ventas de esa jornada; "Volver" regresa a la lista.
4. En el detalle de una venta del historial, el botón secundario dice "Cerrar" y el botón "Imprimir" imprime la boleta.

## Fuera de alcance

- Persistencia. Filtros combinados avanzados (rango de fechas, método). Exportar el detalle.
