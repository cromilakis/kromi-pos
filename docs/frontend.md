# Frontend — kromi-pos

Este documento describe la arquitectura del frontend (React + Vite + TS, dentro del shell Tauri) construida en el sub-proyecto ② (andamiaje). El sub-proyecto ③ implementa los módulos reales sobre esta base.

## Estructura de `src/`

```
src/
  auth/              Autenticación: AuthProvider, LoginScreen, tipos de sesión (Profile, Business, Role)
  session/            Estado de trabajo (sucursal/caja) y gates: WorkContext, BranchGate, CashGate, nav.ts (menú por rol)
  shell/              Layout de la app autenticada: AppLayout (sidebar + topbar), RequireAuth, RequireRole
  routes/             Placeholders de los módulos (Venta, Stock, Clientes, Cierre, Administración) — a reemplazar en ③
  data/               Hooks TanStack Query + llamadas RPC a Supabase (queries.ts: perfil/negocio; work.ts: sucursales/cajas)
  components/ui/      Componentes shadcn/ui (Radix + Tailwind) generados vía CLI — no editar a mano salvo necesidad puntual
  theme/              Aplicación del acento de marca (`business.accent`) como variable CSS
  lib/                Utilidades: RUT (normalización + email sintético), cliente Supabase, mapeo de errores a español
  App.tsx             Definición de rutas (react-router-dom)
  main.tsx            Bootstrap: QueryClientProvider > AuthProvider > WorkProvider > BrowserRouter > App
```

Puntos de entrada:
- `pnpm dev` levanta solo Vite (útil para iterar en UI sin la ventana nativa; el cliente Supabase igual pega a la red).
- `pnpm tauri dev` levanta la ventana Tauri real (shell Rust en `src-tauri/` + este frontend).

## Flujo de autenticación (RUT + PIN)

1. El usuario ingresa **RUT** y **PIN** en `LoginScreen` (`src/auth/LoginScreen.tsx`).
2. `src/lib/rut.ts` normaliza el RUT (`normRut`) y lo transforma en un **email sintético** (`rutToEmail`, formato `<rut-normalizado>@pos.kromi.local`).
3. `AuthProvider.signIn(rut, pin)` llama `supabase.auth.signInWithPassword({ email, password: pin })`. El PIN se usa como password de Supabase Auth.
4. Errores de Supabase se traducen a español con `src/lib/errors.ts` (p. ej. credenciales inválidas → "RUT o PIN incorrecto").
5. Con sesión válida, `useProfileQuery`/`useBusinessQuery` (`src/data/queries.ts`) cargan el `Profile` (incluye `role`, `business_id`) y el `Business` (incluye `accent` para el theming).
6. `RequireAuth` (`src/shell/RequireAuth.tsx`) muestra `LoginScreen` si no hay sesión, o el árbol protegido (`AppLayout`) si la hay.

El alta de nuevos usuarios (crear cuentas de personal) **no se hace desde el cliente**: requiere la *service/secret key* de Supabase, que nunca debe vivir en el frontend. Ver la nota al final de este documento.

## Gates de sucursal y caja

El `WorkContext` (`src/session/WorkContext.tsx`) guarda en memoria la **sucursal** (`branch`) y **caja/register** (`register`) activos durante la sesión de trabajo (no persiste entre reinicios).

`AppLayout` envuelve el contenido de las rutas con dos gates, en orden:

1. **`BranchGate`** (`src/session/BranchGate.tsx`): carga las sucursales del negocio (`useBranches`). Si hay una sola, la auto-selecciona; si hay varias, pide elegir. Bloquea el resto de la UI hasta tener `branch`.
2. **`CashGate`** (`src/session/CashGate.tsx`): dado la sucursal, carga las cajas (`useRegisters`) y auto-selecciona la primera; luego busca la sesión de caja abierta (`useOpenSession`). Si no hay caja abierta, muestra el formulario "Abrir caja" (fondo inicial → `rpcAbrirCaja`). Si ya hay una abierta, deja pasar a los módulos (`<Outlet />`).

La topbar de `AppLayout` (`src/shell/AppLayout.tsx`) muestra el nombre de la sucursal activa y el botón **"Cerrar caja"**, habilitado solo si hay una sesión de caja abierta (`useOpenSession(register?.id)`). Al confirmar en el `AlertDialog` con el monto contado, llama `rpcCerrarCaja(session.id, contado)` e invalida la query `["open-session"]` para que `CashGate` vuelva a pedir apertura.

Todas las operaciones de caja pasan por RPC de Postgres (`abrir_caja`, `cerrar_caja` en `src/data/work.ts`), nunca por escritura directa a tablas desde el cliente.

## Cómo agregar un módulo (para el sub-proyecto ③)

Cada ítem del menú (`src/session/nav.ts`) hoy renderiza un `Placeholder` (`src/routes/placeholders.tsx`) declarado en `App.tsx`. Para implementar un módulo real (Venta, Stock, Clientes, Cierre, Historial, Administración):

1. Crear la pantalla en una carpeta propia, p. ej. `src/modules/venta/VentaScreen.tsx` (usar `prototype/` como referencia visual/funcional).
2. Cablear datos con hooks TanStack Query siguiendo el patrón de `src/data/` (un archivo por dominio, `useQuery` para lecturas, funciones `rpcX` para escrituras vía `supabase.rpc(...)`).
3. Las operaciones críticas de negocio van por **RPC** (`cobrar_venta`, `emitir_nota_credito`, `convertir_cotizacion`, etc.), igual que `abrir_caja`/`cerrar_caja`; no hacer `insert`/`update` directos a tablas sensibles desde el cliente.
4. Reemplazar el `<Placeholder title="..."/>` correspondiente en `src/App.tsx` por la pantalla real. Si el módulo requiere un rol específico, envolver con `RequireRole` (ver el patrón de `AdminRoute` en `App.tsx`).
5. Componentes de UI: preferir los ya generados en `src/components/ui/` (shadcn); agregar nuevos con el CLI de shadcn (`components.json` ya está configurado) en vez de escribirlos a mano.
6. Impresión térmica (ESC/POS) ya vive en Rust (`src-tauri/src/printing.rs`); desde React se invoca vía `@tauri-apps/api` (`invoke(...)`) — no reimplementar lógica de impresión en el frontend.
7. Textos de UI en español; identificadores/código en inglés (estándar del proyecto, ver `CLAUDE.md`).

## Recepción de compras por factura

Módulo de Stock que permite cargar una factura de compra (PDF) de un proveedor, extraer sus datos automáticamente con IA, confirmarlos y sumar el stock recibido — sin digitar la factura línea por línea.

### Flujo

1. **Subir PDF** (`src/modules/stock/InvoiceUpload.tsx`, botón "Cargar desde factura" en `StockScreen`): el usuario elige el PDF de la factura del proveedor.
2. **Extracción con IA** (`extractInvoice` en `src/data/purchases.ts`): el frontend invoca la edge function `extract-invoice` (`supabase.functions.invoke("extract-invoice", { body: form })`) enviando el PDF como `multipart/form-data`. La función:
   - archiva el PDF en el bucket privado `purchase-invoices` (ruta `{business_id}/{uuid}.pdf`, RLS por negocio);
   - sube el PDF a OpenAI Files y llama la **Responses API** con el modelo **`gpt-5-nano`** y un `json_schema` estricto (structured outputs) para extraer proveedor (razón social, RUT), datos del documento (tipo, folio, fecha, neto, IVA, total) y las líneas (código del proveedor, descripción, cantidad, costo unitario, total de línea);
   - devuelve `{ pdf_path, extraction }` al cliente.
3. **Pantalla de confirmación** (`src/modules/stock/InvoiceConfirm.tsx`): muestra los datos extraídos para revisión/edición antes de confirmar. Resuelve el proveedor por RUT (`useSupplierByRut`) — si no existe, se crea uno nuevo al confirmar — y mapea cada línea a un producto existente usando el mapeo proveedor→código guardado en `supplier_product` (`useSupplierProductMap`); si una línea no tiene mapeo, permite crear el producto nuevo.
4. **Confirmar → RPC `recepcionar_factura`** (`recepcionarFactura` en `src/data/purchases.ts`, ver más abajo): registra la factura y sus líneas, actualiza/crea el mapeo `supplier_product` (código de proveedor → producto + último costo) y **suma el stock** de cada línea en la sucursal activa (`inventory.stock`), todo en una sola transacción atómica en la base.
5. La factura queda **archivada y descargable**: `usePurchaseInvoices` lista las últimas facturas del negocio y `invoiceDownloadUrl` genera una signed URL (60s) del PDF en `purchase-invoices` para verla/descargarla.
6. En facturas siguientes del **mismo proveedor**, las líneas cuyo código ya esté en `supplier_product` se **auto-mapean** al producto correspondiente (y se actualiza `last_cost`), evitando volver a mapear manualmente.

### Configurar `OPENAI_API_KEY`

La edge function `extract-invoice` (`supabase/functions/extract-invoice/index.ts`) requiere `OPENAI_API_KEY` (además de `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, ya presentes en el entorno de Supabase).

- **Local**: crear `supabase/functions/.env` (ver `supabase/functions/extract-invoice/.env.example`; el archivo `.env` está en `.gitignore`, nunca se commitea) con:
  ```
  OPENAI_API_KEY=sk-...
  ```
  y servir la función con ese archivo de entorno:
  ```
  supabase functions serve extract-invoice --env-file supabase/functions/.env
  ```
- **Cloud** (proyecto desplegado): configurar el secreto con la CLI, no en el repo:
  ```
  supabase secrets set OPENAI_API_KEY=sk-...
  ```

Sin red o sin la key configurada, la extracción automática falla (la función devuelve `{ error }` y el frontend muestra un toast), pero el resto de la app (BD, RLS, RPC) funciona igual — solo se ve afectada la carga por PDF.

### Tablas y RPC (migración `supabase/migrations/20260707130000_purchases.sql`)

- **`supplier_product`**: mapeo persistente `(supplier_id, supplier_code)` único → `product_id`, más `last_cost` (último costo pagado por ese proveedor/código). Es lo que habilita el auto-mapeo en facturas siguientes del mismo proveedor.
- **`purchase_invoice`**: cabecera de la factura recibida (proveedor, sucursal, tipo/folio/fecha de documento, neto/IVA/total, `pdf_path` al PDF archivado). `unique (business_id, supplier_id, folio)` evita duplicar la misma factura.
- **`purchase_invoice_line`**: líneas de la factura (producto, código del proveedor, descripción, cantidad, costo unitario, total de línea) — historial de costos de compra.
- **RPC `recepcionar_factura(p_branch, p_supplier, p_doc, p_lines, p_pdf_path)`** (`security definer`, atómica): valida que la sucursal pertenezca al negocio del usuario, crea el proveedor si no existe, inserta la cabecera y las líneas, hace upsert de `supplier_product` (mapeo + último costo) y **suma stock** en `inventory` por cada línea (`on conflict ... do update set stock = stock + qty`). Es el único camino de escritura: las tres tablas tienen RLS habilitado con políticas de **solo lectura** por `business_id` (o `is_kromi()`); no hay políticas de `insert`/`update` para el cliente, todo pasa por esta función `grant`eada a `authenticated`.
- El bucket de Storage `purchase-invoices` es privado, con políticas de `select`/`insert` restringidas a la carpeta `{business_id}/...` del usuario autenticado.

## Nota: alta de personal requiere edge function

Crear usuarios nuevos (personal con RUT+PIN) requiere la **secret key** de Supabase (`service_role`), que no debe exponerse nunca en el cliente. Esta funcionalidad **debe implementarse como una Supabase Edge Function** dedicada (invocada desde el frontend con la sesión del admin autenticado, pero ejecutando la creación de usuario del lado del servidor con la secret key). No existe todavía en este repo; se diseña como pieza aparte en el sub-proyecto ③ o posterior.
