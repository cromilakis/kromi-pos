# Registro de empresa para factura + integración al DTE — Diseño

**Fecha:** 2026-07-19
**Rama:** main (rama de trabajo actual)

## Objetivo

Separar el registro de **clientes empresa** (para factura, DTE 33) del registro de
**clientes persona** (formulario actual). El formulario de empresa captura los datos
tributarios obligatorios y una serie de datos opcionales del receptor, y esos datos
viajan a la emisión de la factura electrónica vía la Edge Function `issue-receipt`.

Origen: el bloque Receptor del PDF de la factura hoy sale con datos por defecto
("Cliente sin especificar", RUT 66666666-6, Ciudad/Comuna fijos). Debe reflejar los
datos reales de la empresa, incluyendo **Ciudad** (`CiudadRecep`), que hoy no se mapea.

## Estado actual (verificado)

- **`CustomerForm.tsx`** es un único formulario con toggle "Empresa (factura)". Cuando
  está activo ya pide y valida como obligatorios: **RUT con dígito verificador**
  (`computeRutDv`/`isValidRut`), **razón social**, **giro**, **dirección**, **comuna**.
- **Tabla `customer`** (`src/data/customers.ts`): `name, email, phone, points, spent,
  visits, is_company, rut, razon_social, giro, direccion, comuna`. No tiene ciudad,
  dirección de despacho, contacto ni observaciones.
- **`issue-receipt/index.ts`** (factura, líneas 119-131) mapea el receptor con
  `RUTRecep, RznSocRecep, GiroRecep, DirRecep, CmnaRecep`. **Falta `CiudadRecep`.**
  `FmaPago` está fijo en `1` (contado). Valida que la empresa tenga razón social,
  giro, dirección y comuna.

## Decisiones (aprobadas)

1. **Dos formularios separados.** Nuevo componente `EmpresaForm.tsx` dedicado; el
   `CustomerForm` de persona pierde el toggle empresa. Dos entradas en `ClientesScreen`:
   "Nuevo cliente" y "Nueva empresa". Ambos escriben en `customer` con `is_company`.
2. **Guardar + integrar al DTE** en esta tanda (no solo persistir).
3. **`name` = razón social** (display en la lista). El nombre de contacto va en una
   columna nueva `contacto`.

## Modelo de datos (nueva migración)

Columnas nuevas en `customer`, todas nullable:

| Campo del formulario | Columna | Obligatorio |
|---|---|---|
| Ciudad | `ciudad text` | opcional |
| Dirección de despacho | `direccion_despacho text` | opcional |
| Comuna de despacho | `comuna_despacho text` | opcional |
| Nombre de contacto | `contacto text` | opcional |
| Observaciones | `observaciones text` | opcional |

Reutilizados: `email` → correo DTE; `phone` → teléfono de contacto. Los obligatorios
(`rut, razon_social, giro, direccion, comuna`) ya existen.

## Formulario `EmpresaForm.tsx`

Layout horizontal de dos columnas (consistente con `ProductForm`/`PayDialog`), modal
~880px, header/footer fijos, cuerpo scrolleable (`maxHeight: 90vh`).

- **Obligatorios:** RUT (validado con DV, misma lógica que hoy), razón social, giro,
  dirección tributaria, comuna.
- **Opcionales:** correo DTE, nombre de contacto, teléfono de contacto (máscara
  `+56 9` + 8 dígitos, misma que persona), ciudad, dirección de despacho, comuna de
  despacho, observaciones.
- Al guardar: `name = razon_social`, `is_company = true`.

`src/data/customers.ts`: extender `CustomerRow`, `createCustomer`, `updateCustomer` y
el `select` con las columnas nuevas.

## Integración DTE (`issue-receipt/index.ts`)

En la rama `esFactura`:

1. Cargar del `customer` las columnas nuevas (`ciudad, direccion_despacho,
   comuna_despacho, contacto, email`).
2. Receptor: agregar **`CiudadRecep`** (desde `ciudad`) y, si existen,
   **`CorreoRecep`** (desde `email`) y **`Contacto`** (contacto/teléfono).
3. Bloque **`Transporte`** con `DirDest`/`CmnaDest`/`CiudadDest` solo si hay dirección
   de despacho.
4. `FmaPago` se mantiene en `1` (contado); coincide con el PDF actual.
5. Redesplegar `issue-receipt` al proyecto de producción (`immuembrvocwbdpprypk`).

## Gap declarado — verificar contra docs SimpleFactura

No fue posible extraer la documentación de SimpleFactura de forma automática
(`documentacion.simplefactura.cl` es un Postman/SPA que no renderiza en texto plano).
Antes de implementar el paso DTE se deben **verificar contra el Postman en vivo** los
nombres y ubicación exactos de los campos opcionales del JSON de factura 33:
`CiudadRecep`, `Contacto`, `CorreoRecep` y el bloque `Transporte`
(`DirDest`/`CmnaDest`/`CiudadDest`, e indicadores `IndTraslado` si aplica). Los campos
obligatorios ya están verificados en el código actual.

## Fuera de alcance

- Cambiar `FmaPago` a crédito/selección de forma de pago (lo completa el emisor).
- Tipo de venta / detalle de compra en el formulario (lo completa el emisor).
- Migración de datos de empresas ya cargadas con el toggle (siguen funcionando; los
  campos nuevos quedan vacíos).

## Testing

- `test:db`: la migración corre limpia; RLS de `customer` sigue vigente para las
  columnas nuevas.
- Validación de RUT: reutiliza la lógica existente (ya cubierta).
- Emisión factura: prueba manual contra SimpleFactura verificando que el PDF muestre
  Ciudad real y datos del receptor correctos.
