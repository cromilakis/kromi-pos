# Boleta (39) vs Factura (33) en la venta — Diseño

**Fecha:** 2026-07-14
**Rama:** feature/notas-credito (rama de trabajo actual)

## Objetivo

Permitir elegir en la venta si se emite **boleta electrónica (DTE 39)** o **factura
electrónica (DTE 33)**. La factura requiere un receptor identificado (cliente-empresa
con datos tributarios) y se emite con precios netos derivados del precio de catálogo.

## Estado actual (verificado)

- **Emisión:** `issue-receipt/index.ts` hardcodea `TipoDTE:39`, Emisor formato boleta
  (sin `Acteco`) y `Receptor:{RUTRecep:"66666666-6", RznSocRecep:"Consumidor Final"}`.
  El wrapper `issueReceipt(saleId)` (src/data/sii.ts) solo pasa `sale_id`.
- **Cliente** (`customer`, catálogo + `src/data/customers.ts`): `name, email, phone,
  points, spent, visits`. **No tiene datos tributarios.**
- **Venta** (`sale`): sin campo de tipo de documento; `dte_*` asume boleta.
- **RPC** `charge_sale`/`_register_sale`: `neto = round(total/1.19)` (precios con IVA
  incluido, modelo boleta). No recibe tipo de documento.
- **Skill `simplefactura-dte`** documenta factura 33: Emisor con `Acteco`, `FmaPago`,
  Receptor completo (RUT, razón social, giro, dirección, comuna), detalle en netos.
- La factura 33 ya tiene sets de certificación SOK (San José SpA); falta la
  Declaración de Cumplimiento (gestión del usuario, fuera del código).

## Decisiones (aprobadas)

1. **Receptor = cliente-empresa:** los datos tributarios se guardan en el cliente
   (toggle persona/empresa). La factura se emite a un cliente-empresa.
2. **Derivar neto:** un solo precio (con IVA incluido). La factura deriva el neto por
   línea (`neto = precio/1,19`). El cliente paga el mismo total; cambia el desglose.
3. **FmaPago:1** (contado) en factura (POS cobra al momento).

## Cambios por capa

### 1. Cliente-empresa (migración aditiva + data + UI)
- `alter table public.customer add column is_company boolean not null default false,
  rut text, razon_social text, giro text, direccion text, comuna text;` (nullable;
  obligatorios a nivel de UI/servidor solo cuando `is_company`).
- `src/data/customers.ts`: `CustomerRow` + select + `createCustomer`/`updateCustomer`
  con los campos nuevos.
- `src/modules/clientes/CustomerForm.tsx`: toggle **"Empresa (factura)"**; al activar,
  muestra y exige RUT (validado con el helper de RUT), razón social, giro, dirección,
  comuna.

### 2. Tipo de documento en la venta (migración + RPC)
- `alter table public.sale add column doc_type text not null default 'boleta'
  check (doc_type in ('boleta','factura'));`
- `charge_sale` gana `p_doc_type text default 'boleta'` (drop firma vigente + create +
  grant, patrón de migraciones previas). Persiste `sale.doc_type`. Validación de
  servidor: si `p_doc_type='factura'` ⇒ `p_customer` no nulo y el cliente
  `is_company = true` con `rut` no nulo; si no, excepción.
- El cálculo `neto/iva/total` **no cambia** (precios con IVA incluido).

### 3. Emisión DTE — generalizar `issue-receipt` para 39/33
- La edge function lee `sale.doc_type` (agregar al select) y el `customer` cuando es
  factura, y ramifica:
  - **39 (boleta):** comportamiento actual.
  - **33 (factura):** `TipoDTE:33`; Emisor con `Acteco` + `CiudadOrigen` (nuevas env
    vars/secrets del emisor); `IdDoc` con `FmaPago:1` (sin `IndServicioBoleta`);
    `Receptor` real desde el cliente (`RUTRecep`, `RznSocRecep`, `GiroRecep`,
    `DirRecep`, `CmnaRecep`); **Detalle en netos**: `PrcItem`/`MontoItem` netos
    derivados (`round(precio_con_iva/1.19)`), con su `DescuentoMonto` neto si aplica.
  - **Redondeo:** la suma de netos por línea puede no coincidir con `round(total/1.19)`.
    Se informa `MntNeto` = suma de netos de línea, `IVA = round(MntNeto*0.19)`,
    `MntTotal = MntNeto + IVA`; se documenta y **se valida contra emisión real** (no
    solo `/dte/preview`) por las advertencias del skill. El total al cliente puede
    diferir del `sale.total` en ±1 peso por redondeo; se acepta y se valida.
  - Timbre: `codigoTipoDte` = 33 o 39 según corresponda.
- Wrapper `issueReceipt(saleId)` sin cambios (el tipo se lee del `sale`).

### 4. UI de venta — selector Boleta/Factura
- En el cobro (`PayDialog`): selector **Boleta (default) / Factura**. Factura
  habilitada solo si el cliente seleccionado es empresa con datos completos; si no,
  deshabilitada con hint. `handleConfirmPay` pasa `p_doc_type`.

### 5. Impresión (escpos.rs, Rust)
- `ReceiptPayload` gana `doc_type` y datos del receptor (razón social, RUT, giro,
  dirección). En factura, encabezado "FACTURA ELECTRÓNICA", bloque de receptor y
  desglose neto+IVA. Se puebla en VentaScreen (emisión/reimpresión) e historial.

### 6. Historial
- Etiqueta **Boleta/Factura** por venta (el folio SII ya se muestra).

## Tests
- `pnpm test:db`: `charge_sale` con `p_doc_type='factura'` exige cliente-empresa
  (excepción si no lo es / sin RUT); persiste `doc_type`; boleta sigue funcionando.
- Unit (frontend): validación de datos de empresa en CustomerForm (RUT); habilitación
  del selector de factura según cliente.
- La emisión real del DTE 33 (payload, redondeo, aceptación SII) la valida el usuario
  (consume folios de factura).

## Fuera de alcance (YAGNI)
- Notas de crédito sobre facturas (NC sigue igual por ahora).
- Facturas a crédito (`FmaPago:2`); múltiples referencias.
- Doble precio neto/bruto por producto.

## Criterios de aceptación
1. Se puede marcar un cliente como empresa con datos tributarios validados.
2. En el cobro se elige boleta o factura; factura solo con cliente-empresa.
3. La venta persiste su `doc_type`; `charge_sale` valida factura ⇒ cliente-empresa.
4. La factura 33 se emite con receptor real, Emisor con Acteco y detalle en netos;
   la boleta 39 sigue igual.
5. El comprobante impreso de factura muestra receptor y desglose neto+IVA.
6. El historial distingue boleta de factura.
