# Diseño — ③a Módulos de operación (el POS que vende)

**Proyecto:** kromi-pos
**Fecha:** 2026-07-07
**Sub-proyecto:** ③a (primer entregable de ③; ③b = Administración va aparte)
**Depende de:** ① Fundación de datos (en main), ② Andamiaje del frontend (PR #3).
**Estado:** aprobado en brainstorming; pendiente de plan.

---

## 1. Contexto y dirección

El andamiaje ② dejó login, shell (fiel al prototipo), navegación por rol, capa de datos
(Supabase + TanStack Query), `WorkContext` (sucursal/caja) y **placeholders** por módulo.
③a reemplaza los placeholders de los módulos de **operación** por las pantallas reales.

**Dirección (decidida por el usuario):** todo debe verse **idéntico al prototipo**
(`prototype/index.html`). Cada módulo se **clona** del prototipo (markup fiel, Satoshi,
branding de la tienda) y se **cablea a datos reales**. shadcn se usa solo como base de
primitivos accesibles tematizados; los layouts se clonan con markup fiel.

## 2. Decisiones fijadas (del brainstorming)

| Tema | Decisión |
|---|---|
| Fidelidad | **Idéntico al prototipo** (clonar), no rediseño |
| Flujo de caja | **Sin gate bloqueante**: Inicio = dashboard; abrir/cerrar caja son acciones; **solo Venta exige caja abierta** |
| Métricas / stats | **Derivadas de datos reales** (agregaciones sobre ventas) |
| Alta de personal | **Edge function** con service_role → sub-proyecto ③b (aquí no) |
| Impresión | Reusar funciones Rust existentes en `src-tauri` vía `@tauri-apps/api` `invoke` |
| Datos iniciales | BD **vacía** (de ①): el usuario carga catálogo/clientes desde la app |
| Cotizaciones / Notas de crédito | **Incluidas** dentro de Venta (las RPC `convertir_cotizacion`/`emitir_nota_credito` ya existen en ①) |

## 3. Enfoque común de portado

Para cada módulo:
1. **Clonar la UI** del prototipo (sección correspondiente de `prototype/index.html`),
   traduciendo el markup a componentes React/TSX con los mismos estilos (colores, radios,
   tipografía Satoshi, layout). Marca vía `var(--brand)` (no `var(--accent)`).
2. **Cablear datos**:
   - Lecturas → hooks TanStack Query en `src/data/` (siguiendo el patrón de `queries.ts`/`work.ts`),
     filtrando por negocio/sucursal (RLS ya protege).
   - Operaciones críticas → RPC de ① (`cobrar_venta`, `emitir_nota_credito`,
     `convertir_cotizacion`, `cerrar_caja`, `abrir_caja`).
   - Escrituras simples (crear/editar producto, categoría, cliente) → `from(...).insert/update`
     con RLS (admin donde corresponda).
   - Impresión → `invoke('print_receipt' | 'print_cierre' | 'print_quote' | 'print_credit_note', ...)`.
3. **Estados no felices** con diseño (vacío/carga/error), toasts en fallos (patrón de ②).
4. Cada pantalla vive en su carpeta bajo `src/modules/<modulo>/` con archivos enfocados
   (una responsabilidad por archivo); los hooks de datos en `src/data/`.

## 4. Ajuste del flujo de caja (cambio al andamiaje ②)

- Quitar el `CashGate` del envoltorio global en `AppLayout` (hoy bloquea todo). El
  `BranchGate` (elegir sucursal) se conserva.
- El estado de caja (sesión abierta de la sucursal/caja activa) vive en `WorkContext` y se
  expone a los módulos.
- **Inicio** muestra el dashboard siempre; si no hay caja abierta, muestra el CTA "Abrir caja"
  (`abrir_caja`). **Venta** exige caja abierta: sin ella, muestra un CTA para abrirla en vez
  del carrito. **Cierre** cierra la caja (`cerrar_caja`).

## 5. Módulos (orden de implementación)

### 5.1 Inicio (dashboard)
Clona la pantalla "Inicio" del prototipo (eyebrow, título, tarjetas de stats, CTA de venta,
actividad reciente, panel de stock crítico para admin). Cablea:
- Stats del día: agregaciones sobre `sale` de la sucursal (total vendido, número de ventas,
  ticket promedio, etc.) — derivadas de datos reales.
- Estado de caja: sesión abierta de la caja activa; botón "Abrir caja".
- Actividad reciente: últimas ventas de la sucursal.
- Stock crítico (solo admin): productos de la sucursal con `stock <= min_stock`.

### 5.2 Stock
Clona la pantalla de stock del prototipo. Cablea:
- Lista de productos con stock **por sucursal** (`product` + `inventory` de la sucursal activa),
  filtro por categoría, búsqueda, marca de crítico (`stock <= min_stock`).
- CRUD de **productos** (`from('product')` insert/update; soft-delete `deleted_at`) — solo admin.
- CRUD de **categorías** (`from('category')`), sin poder eliminar categoría con productos.
- Ajuste de stock por sucursal (`inventory` upsert; escritura gateada a admin por RLS).
- Import/export CSV de stock (como el prototipo: exportar críticos, importar cantidades).

### 5.3 Venta
Clona la pantalla de venta del prototipo (catálogo en grilla, buscador/escáner, carrito,
totales con IVA, cobro). Cablea:
- Catálogo: `product` + `inventory` de la sucursal (disponibilidad = stock de la sucursal).
- Carrito y totales en estado local (IVA incluido, como el prototipo).
- Cobro: `rpc('cobrar_venta', { p_branch, p_session, p_lines, p_method, p_recv, p_customer })`
  → devuelve la venta; luego imprimir boleta (`invoke('print_receipt', ...)`).
- **Requiere caja abierta**: sin sesión abierta muestra CTA "Abrir caja".
- **Cotizaciones**: crear cotización desde el carrito (`from('quote')`/`quote_line`) y
  convertir a venta (`rpc('convertir_cotizacion')`); impresión (`invoke('print_quote')`).
- **Notas de crédito**: emitir (`rpc('emitir_nota_credito')`) con reposición de stock;
  impresión (`invoke('print_credit_note')`).
  > Nota: quote/quote_line quedaron solo-lectura para el cliente en el RLS de ①. Crear
  > cotizaciones requiere permitir su escritura por usuarios del negocio (ajuste menor de RLS
  > en una migración de ③a) o una RPC `crear_cotizacion`. Se resuelve en el plan.

### 5.4 Cierre
Clona la pantalla de cierre del prototipo (arqueo, conteo, resumen). Cablea:
- Cerrar caja: `rpc('cerrar_caja', { p_session, p_counted })` → resumen (efectivo/tarjeta/
  descuadre); impresión de comprobante de cierre (`invoke('print_cierre')`).
- Historial de cierres: `cash_session` cerradas de la sucursal, con sus totales.

### 5.5 Clientes
Clona la pantalla de clientes del prototipo. Cablea:
- Lista/búsqueda de `customer` del negocio.
- CRUD (`from('customer')` insert/update; soft-delete).
- Fidelización: puntos/gasto/visitas se muestran (los actualiza `cobrar_venta`).

## 6. Errores y edge cases

- Operaciones RPC: mostrar el mensaje en español que devuelven (stock insuficiente, caja no
  abierta, etc.) vía toast; nunca dejar la pantalla a medias.
- Vender sin caja / sin stock: CTA o bloqueo claro, coherente con los invariantes del backend.
- Impresión: si `invoke` falla (sin impresora), avisar sin perder la venta ya registrada
  (la venta se confirma en la BD antes de imprimir).
- BD vacía: estados vacíos con diseño ("aún no hay productos", etc.) y CTA para crear.

## 7. Testing y verificación

- Unit (Vitest): cálculos de totales/IVA en el carrito, mapeos de datos, derivación de stats.
- Verificación en vivo end-to-end contra Supabase: crear categoría+producto (Stock) →
  abrir caja (Inicio) → vender y cobrar (Venta) → ver stock bajar y stats subir → cerrar caja
  (Cierre) → alta de cliente y venta con cliente (fidelización).

## 8. Fuera de alcance de ③a (→ ③b)

Historial (de ventas/boletas como módulo de administración), Proveedores, Personal (+ edge
function de alta), Métricas (pantalla dedicada), Configuración, Respaldo, y el submenú
completo de Administración en la barra lateral. La consola multi-negocio del rol `kromi`
queda fuera de ③ por completo (no es parte de este negocio).

## 9. Trazabilidad al prototipo (`prototype/index.html`)

- Inicio: sección "Inicio" (dashboard, stat cards, actividad).
- Venta: pantalla de venta + `confirmPay`, cotizaciones (`createQuote`/`convertQuote`),
  NC (`saveCreditNote`).
- Stock: pantalla de stock + CRUD productos/categorías + import/export CSV.
- Cierre: pantalla de cierre + `doCierre`.
- Clientes: pantalla de clientes + `saveCustomer`.
- Impresión: `print_receipt`/`print_quote`/`print_cierre`/`print_credit_note` (Rust, ya existen).
