# Diseño — Boleta electrónica ante el SII vía SimpleFactura

**Fecha:** 2026-07-08
**Proyecto:** kromi-pos
**Estado:** aprobado (diseño); pendiente plan de implementación

## Contexto

La boleta térmica actual imprime un **timbre dummy** (placeholder `timbre_dummy` en
`src-tauri/src/escpos.rs`): no es un documento tributario válido. El objetivo es
emitir la **boleta electrónica (DTE tipo 39)** real ante el SII a través del
servicio contratado **SimpleFactura** (Chilesystems), obtener el **folio** y el
**timbre (TED)**, e imprimirlos en la boleta térmica.

SimpleFactura expone una **API REST** (JWT) que gestiona internamente el timbraje
(CAF), la firma y el envío al SII, y devuelve folio, TED, PDF y XML. Documentación:
`https://documentacion.simplefactura.cl/`; ejemplos oficiales en
`github.com/chilesystems/samples-dte`.

## Decisiones tomadas

- **Ambiente de pruebas**: se desarrolla y prueba contra la **cuenta demo** de
  SimpleFactura (certificado y folios/CAF precargados, contra **certificación**
  del SII). Cero riesgo de emitir documentos reales de la empresa mientras se
  implementa. Producción queda para después, con las credenciales del negocio.
- **Emisión no bloqueante**: cobrar **nunca** se bloquea por la emisión. Se intenta
  emitir best-effort (síncrono con timeout corto); si falla, la venta queda
  `pendiente` y se reintenta (la norma da hasta 1h para enviar la boleta al SII).
- **Timbre en boleta ESC/POS**: se reemplaza el timbre dummy por el **TED real**
  codificado en **PDF417**. Si la impresora (GEZHI 80mm) no soporta PDF417 nativo
  (`GS ( k`), se genera como raster (igual que el dummy actual).
- **Persistencia del TED**: el TED emitido es **inmutable**; se guarda en la venta
  y es la fuente de verdad para imprimir y **reimprimir** sin volver a llamar al
  SII (funciona offline).
- **Reimpresión**: la primera impresión sale limpia; las reimpresiones llevan la
  leyenda **"REIMPRESIÓN"** (el original tributario es el registro en el SII).
- **Seguridad**: las credenciales SimpleFactura viven como **secrets de la Edge
  Function**, nunca en el cliente Tauri ni en la base de datos.

## Arquitectura

### Edge Function `emitir-boleta` (Supabase, server-side)
Único componente que conoce las credenciales. Pasos:
1. Obtiene token JWT (`/token`) usando las credenciales (secrets). Cachea el token
   mientras sea válido (24h) respetando el rate limit (2 req/s, 100 req/min).
2. Arma el **DTE 39** con los datos de la venta (emisor = negocio; detalle = líneas
   de `sale_line`; totales; forma de pago).
3. Emite en SimpleFactura y recupera **folio SII + TED + track-id** (y PDF/XML si se
   requieren para respaldo).
4. Actualiza la venta: `dte_status`, `dte_folio`, `dte_ted`, `dte_track_id`,
   `emitted_at`. Ante error, deja `dte_status='error'` (reintetable) y registra el
   detalle.
5. Devuelve al cliente lo necesario para imprimir (folio + TED).

El cliente Tauri **no** llama directo a SimpleFactura.

### Datos (migración)
En `public.sale`, columnas para el DTE (todas opcionales, la venta ya existe):
- `dte_status` text/enum: `pendiente` | `emitida` | `rechazada` | `error` (default `pendiente`).
- `dte_folio` int (folio SII asignado).
- `dte_ted` text (el TED/timbre, para regenerar el PDF417).
- `dte_track_id` text (seguimiento del envío al SII).
- `emitted_at` timestamptz.

La escritura de estas columnas la hace la Edge Function (server-side, service role
o RPC), no el cliente.

## Flujo de cobro

1. `cobrar_venta` registra la venta (como hoy). **No cambia** — la venta y el cobro
   son independientes de la emisión.
2. El frontend invoca `emitir-boleta(sale_id)` con timeout corto:
   - **Éxito**: imprime la boleta térmica **con folio + TED (PDF417)** real.
   - **Falla**: imprime un **comprobante interno** con la leyenda "BOLETA PENDIENTE
     DE EMISIÓN" (no es el documento tributario válido); la venta queda
     `dte_status ∈ {pendiente, error}` para reintento.
3. **Reintento**: acción para reemitir las ventas pendientes/con error (botón en el
   listado de ventas del día y/o reintento automático al reabrir la pantalla). Al
   emitirse, se guarda el TED y se puede **reimprimir** la boleta válida.

## Impresión

- **Número de boleta = folio del SII**: el recuadro "R.U.T. … / BOLETA ELECTRONICA /
  Nº …" debe imprimir el **`dte_folio` (folio asignado por el SII)**, que es el que
  tiene validez legal — **no** el `sale.folio` interno. El folio interno queda solo
  como referencia operativa (no aparece como número de boleta electrónica).
- `escpos.rs`: el bloque de timbre usa el **TED** del payload en vez del dummy.
  - Si hay TED → recuadro con **folio SII** + PDF417 (nativo `GS ( k` o raster) +
    leyenda SII real.
  - Si no hay TED (pendiente) → **no** se imprime un "Nº" de boleta electrónica; el
    comprobante interno lleva la leyenda "BOLETA PENDIENTE DE EMISIÓN" (puede
    mostrar el folio interno solo como referencia).
- Flag `reimpresion: bool` en el payload → imprime "REIMPRESIÓN" cuando corresponde.

## Manejo de errores

- Fallo de red/timeout al emitir → venta `pendiente`, comprobante interno, reintento.
- Rechazo del SII/SimpleFactura → `rechazada`, con el motivo guardado para revisión
  (no reintentar automáticamente un rechazo de validación).
- La Edge Function valida tenancy y que la venta exista y no esté ya emitida
  (idempotencia: no emitir dos veces la misma venta).

## Pruebas

- Contra la **cuenta demo** (certificación). Casos: emisión exitosa (timbre en
  boleta), emisión fallida (comprobante pendiente + reintento exitoso),
  reimpresión (misma boleta desde el TED persistido, con leyenda), idempotencia
  (no doble emisión).
- Tests unitarios del armado del payload DTE (función pura) y del render del timbre.

## Pendiente de detalle (se resuelve en el plan)

- El **JSON exacto** del request de emisión de boleta (DTE 39) y el **formato del
  campo TED** en la respuesta, tomados del SDK/colección oficial de SimpleFactura
  (o de la colección Postman/credenciales que provea el usuario) al escribir el plan.
- Confirmar el **endpoint** exacto de boleta (la doc lista `/invoiceV2/Casa_Matriz`,
  `/dte/timbre`, `/dte/pdf`, `/dte/xml`, `/documentIssued`).
- Soporte **PDF417 nativo** de la GEZHI vs. raster.

## Fuera de alcance (YAGNI)

- Emisión en **producción** real (se hará al pasar de certificación a producción,
  con credenciales y CAF del negocio; requiere gestión legal/tributaria del usuario).
- Otros DTE (factura 33, guías, exportación): solo boleta 39 por ahora.
- Anulación de boletas / notas de crédito electrónicas ante el SII (el módulo de NC
  actual sigue siendo interno por ahora).
- Reportes/libro de ventas electrónico.
