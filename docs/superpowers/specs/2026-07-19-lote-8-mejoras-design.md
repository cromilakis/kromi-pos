# Diseño — Lote de 8 mejoras (factura, caja, arqueo, stock, NC, historial, vuelto, folios)

Fecha: 2026-07-19
Estado: aprobado (pendiente de plan de implementación)

## Contexto y decisiones transversales

- **Ninguno de los 8 puntos requiere cambio de esquema de BD.** Todo es frontend +
  Edge Functions; los datos ya existen (`customer.is_company`/tributarios,
  `sale.doc_type/recv/change/dte_folio`, `cash_session.opened_at`). La **única
  migración a validar contra el respaldo** es la del redondeo pendiente
  (`20260719120000_cash_rounding_ley20956.sql`), sin cambios.
- **App en PRODUCCIÓN.** Nada emite DTE reales para probar; validación de emisión
  solo en cuenta demo (ambiente 0). La migración del redondeo se aplica a prod
  como paso aparte con OK del usuario.
- **Ejecución por clusters, subagentes secuenciales con review.** Commits firmados
  `Cromilakis <ipcromilakis@gmail.com>`, sin `Co-Authored-By` ni atribución a
  Claude. Prosa español, identificadores inglés.
- Fuentes SimpleFactura verificadas (doc oficial): factura 33 (`/invoiceV2`,
  precios netos, Emisor con Acteco), NC 61 (`/invoiceCreditDebitNotesV2`,
  Referencia con `TpoDocRef` numérico y `FolioRef`=folio SII), folios (endpoints
  abajo).

---

## Cluster 1 — Frontend simple (sin DTE, sin BD)

### #3 — Quitar "Gracias por tu compra" del comprobante de arqueo
- `src-tauri/src/escpos.rs` `build_cierre()`: eliminar la línea que imprime
  `p.negocio.footer` (~línea 497). El arqueo no es una compra. `build()` (boleta) y
  `build_credit_note()` mantienen el footer.

### #4 — Doble clic en un producto de Stock abre el popup de edición
- `src/modules/stock/StockScreen.tsx`: agregar `onDoubleClick={() => setEditing(p)}`
  en la fila del producto (mismo efecto que el botón lápiz que hoy hace
  `setEditing(p)`). Sin cambios de datos.

### #6 — Filtrar el historial por medio de pago (Efectivo/Tarjeta)
- `src/data/salesHistory.ts`: `SalesHistoryFilters` gana `method?: "efectivo" |
  "tarjeta" | null`; en `useSalesHistory` aplicar `.eq("method", method)` cuando
  esté definido. (El query ya selecciona `method`.)
- `src/modules/historial/HistorialScreen.tsx`: control de filtro (Todos / Efectivo
  / Tarjeta) que setea el filtro y re-consulta, siguiendo el patrón de los filtros
  existentes (fechas/cliente/folio).

### #7 — El vuelto queda fijo tras confirmar el cobro
- Causa: en el flujo de cobro, `setCart([])` (`VentaScreen.tsx:403`) corre **antes**
  de emitir/imprimir → el `total` que recibe `PayDialog` cae a 0 → el "Vuelto"
  cambia.
- Fix (en `PayDialog.tsx`): al presionar Confirmar, **congelar** los valores
  mostrados (payTotal, recv, vuelto) y renderizar esos valores capturados mientras
  `busy` (durante emisión/impresión), en vez de recomputarlos desde props. El
  cajero ve el vuelto fijo hasta que el diálogo se cierra. No cambia lo que se
  envía en `onConfirm` (sigue mandando `recv`).

### #2 — Bloquear Venta si la caja quedó abierta de un día anterior
- `src/data/work.ts` `useOpenSession`: incluir `opened_at` en el select/retorno.
- `src/modules/venta/VentaScreen.tsx`: al entrar, si hay sesión abierta y
  `opened_at` es de una fecha **anterior a hoy** (comparación por día local),
  mostrar un bloqueo/mensaje: "La caja fue abierta el <fecha>. Debes realizar el
  cierre de ese día antes de vender hoy." con acceso al cierre. No permite vender
  hasta cerrar. (Frontend; sin migración.)

---

## Cluster 2 — Factura (#1): elegir/crear cliente empresa desde el cobro

El flujo de factura ya está implementado (CustomerForm marca empresa;
`issue-receipt` emite el 33; `charge_sale` valida). El único roce es que para
facturar hay que pre-crear el cliente empresa en la pantalla Clientes. Cambio:

- En el diálogo de cobro (`PayDialog` + `VentaScreen`/`CustomerPickerDialog`),
  permitir **seleccionar** un cliente y, si hace falta, **crearlo/marcarlo como
  empresa** con sus datos tributarios (RUT, razón social, giro, dirección, comuna)
  sin salir de la venta, de modo que "Factura" se habilite ahí mismo.
- Reutilizar `CustomerForm` (ya tiene el switch Empresa + validación de RUT) dentro
  del flujo de cobro, o extender `CustomerPickerDialog` para crear empresa.
- El resto (emisión del DTE 33) ya funciona; no se toca `issue-receipt`.
- El detalle de UI (modal anidado vs. paso extra) se define en el plan; requisito:
  poder terminar en "Factura" habilitado eligiendo/creando la empresa en el cobro.

---

## Cluster 3 — Nota de crédito (#5): búsqueda por folio SII + NC correcta para boleta y factura

Solo dejar el código listo; **no emitir** NC reales (validación de búsqueda con
folio 5033 = solo lectura).

### 3.1 Búsqueda por folio SII (siempre, nunca el correlativo interno)
- `src/data/sales.ts` `buscarVentaPorFolio`: cambiar `.eq("folio", folio)` por
  **`.eq("dte_folio", folio)`**. La búsqueda es **siempre** por el folio SII
  (`dte_folio`); nunca por el correlativo interno `sale.folio`. Mantiene
  `.eq("branch_id", branchId)`.

### 3.2 NC correcta para boleta (39) y factura (33)
`supabase/functions/issue-credit-note/index.ts` hoy hardcodea `TpoDocRef:"39"` y un
receptor genérico de boleta. Cambios:
- Leer de la venta original su `doc_type` y `customer_id` (y el `customer` con datos
  tributarios).
- `Referencia.TpoDocRef` = `"39"` si la venta original es boleta, `"33"` si es
  factura. `FolioRef` = `sale.dte_folio` (folio SII). `FchRef` = `sale.emitted_at`.
  `CodRef` = `nc.cod_ref`.
- `Receptor`: para NC de boleta, receptor genérico consumidor final (66666666-6);
  para NC de factura, el **receptor real** de la empresa (RUT con guion, razón
  social, giro, dirección, comuna) desde el `customer`.
- Emisor: formato factura (RznSoc/GiroEmis/Acteco/CiudadOrigen) para NC, igual que
  ya hace `issue-receipt` para el 33.
- Nota (conflicto documentado, NO se cambia ahora): el `{motivo}` de la URL
  `/invoiceCreditDebitNotesV2/{suc}/{motivo}` — la doc oficial dice que es un código
  de "razón" 1-6 (y sus ejemplos usan 6), distinto del `CodRef`; la experiencia de
  certificación de la skill mapea motivo=CodRef. Se mantiene el comportamiento
  actual (`cod_ref` como motivo) y se marca para **re-test en vivo** antes de
  emitir NC reales.

---

## Cluster 4 — Folios (#8): pestaña en Administración

Nueva Edge Function + pestaña "Folios" en Admin. Los folios se consultan/solicitan
vía SimpleFactura (token + credenciales server-side).

### 4.1 Edge Function `supabase/functions/folios/index.ts`
Acciones (por `tipoDTE` en {39 boleta, 33 factura, 61 NC}):
- **Disponibles sin usar** (para emitir): `POST /folios/consultar/sin-uso`
  `{rutEmpresa, tipoDTE, ambiente}` → `data:[{desde,hasta,cantidad,sucursal}]`;
  la Edge Function suma `cantidad`.
- **Máximo a solicitar**: `POST /folios/consultar/disponibles`
  `{rutEmpresa, tipoDTE, ambiente}` → `data:<int>`. Semántica confirmada:
  para tipos {39,41,34,52,110,111,112} `data` es siempre `0` = **sin límite**;
  para {33,61,46,56,43} `data` es el **cap real**. La Edge Function devuelve
  `{ maxRequestable: number|null }` (null = sin límite).
- **Solicitar**: `POST /folios/solicitar`
  `{credenciales:{rutEmisor,nombreSucursal}, cantidad, codigoTipoDte, ambiente}`
  (cantidad > 0). Devuelve el CAF nuevo.
- Reutiliza el patrón de token/credenciales de `issue-receipt` (secrets
  `SIMPLEFACTURA_*`). Ambiente = `SIMPLEFACTURA_AMBIENTE`.

### 4.2 Pestaña "Folios" en `src/modules/admin/AdminScreen.tsx`
- Nueva pestaña `folios`. Por cada tipo (Boleta 39, Factura 33, Nota de crédito 61):
  mostrar **disponibles (sin usar)** y **máximo a solicitar** ("Sin límite" si es
  null), un input de cantidad (capado al máximo cuando aplique, > 0), y un botón
  "Solicitar" que llama a la Edge Function y refresca los conteos.
- Data layer (`src/data/folios.ts` o similar) que invoca la Edge Function.

---

## Testing / verificación
- **#3/#7/#4/#6/#2**: `pnpm build` + `pnpm test`; escpos test para #3 (el cierre no
  contiene "Gracias"); tests de filtro para #6 si aportan; verificación manejando la
  app donde sea visual (#4/#7/#2).
- **#5**: unit/estático — `buscarVentaPorFolio` usa `dte_folio`; el body de la NC
  deriva `TpoDocRef`/receptor por `doc_type`. Prueba de **lectura** con folio 5033
  sobre el respaldo local (buscar la venta, sin emitir). Validación del request de
  NC contra demo (opcional, sin emitir a prod).
- **#8**: validar las 3 llamadas contra la cuenta **demo** (ambiente 0): consultar
  sin-uso, consultar disponibles (verificar 0=sin límite para 39 y cap real para
  33/61), y una solicitud de prueba en demo.
- **Migración redondeo**: aplicar `20260719120000` sobre el **respaldo** local y
  correr `pnpm test:db` para validar antes de prod.

## Fuera de alcance
- Cambios de esquema de BD (ninguno necesario).
- Emitir NC/DTE reales en producción (solo demo / lectura).
- Reconciliar el conflicto doc-vs-cert del `{motivo}` de NC (se re-testea en vivo
  aparte).
