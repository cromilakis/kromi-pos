# Diseño — Carrito de venta persistente al navegar entre menús

Fecha: 2026-07-18
Estado: aprobado (pendiente de plan de implementación)

## Problema

El carrito de la pantalla de Venta se pierde al cambiar de menú. Si el usuario
va a Cotizaciones (u otro módulo) y vuelve a Venta, el carrito queda vacío.
Causa: `cart` y `customerId` son `useState` locales de `VentaScreen`
(`src/modules/venta/VentaScreen.tsx:91,95`); al navegar, react-router desmonta
la pantalla (`<Route path="venta" element={<VentaScreen />} />`) y el estado
local se destruye.

## Decisiones (confirmadas con el usuario)

- **Durabilidad: en memoria.** El carrito sobrevive la navegación entre menús
  mientras la app está abierta; se limpia al cerrar/reiniciar la app. NO se
  persiste a disco (para parquear una venta a propósito ya existe "Mantener"/hold).
- **Alcance: carrito + cliente seleccionado.** Se conservan los ítems y el
  `customerId` (y por ende si la venta va como boleta/factura).

## Solución

Estado compartido "venta en curso" (draft) en un React Context montado por
encima de las rutas, dentro de `AppLayout` (que persiste al navegar: solo cambia
el `<Outlet/>`).

### 1. `src/session/SaleDraftContext.tsx` (nuevo)

Sigue el patrón de `src/session/WorkContext.tsx`. Expone:

```ts
export interface CartItem { id: string; qty: number }

interface SaleDraftCtx {
  cart: CartItem[]; setCart: (c: CartItem[] | ((prev: CartItem[]) => CartItem[])) => void;
  customerId: string | null; setCustomerId: (id: string | null) => void;
  resetDraft: () => void;   // cart = [], customerId = null
}
```

- `SaleDraftProvider({ children })`: `useState` en memoria para `cart` y
  `customerId`; `resetDraft` limpia ambos.
- `useSaleDraft()`: hook con guard (throw si se usa fuera del provider), igual
  que `useWork()`.
- El tipo `CartItem` (`{ id: string; qty: number }`) se **mueve** desde
  `VentaScreen` a este módulo y se importa donde haga falta.

### 2. Montaje del provider

En `src/shell/AppLayout.tsx`, envolver el contenido que renderiza el `<Outlet/>`
con `<SaleDraftProvider>`. Debe quedar dentro de `AppLayout` (bajo `RequireAuth`)
para que:
- sobreviva los cambios de ruta (AppLayout no se desmonta al navegar), y
- se limpie en **logout** (al fallar `RequireAuth`, `AppLayout` se desmonta y el
  provider con su estado desaparece → un cajero nuevo no hereda el carrito).

### 3. `VentaScreen`

- Eliminar los `useState` locales de `cart` y `customerId` y la interfaz local
  `CartItem`; consumir `const { cart, setCart, customerId, setCustomerId, resetDraft } = useSaleDraft()`.
- Los puntos que hoy limpian el carrito deben usar los setters del contexto:
  - Tras **cobrar** la venta con éxito → `resetDraft()` (limpia carrito y cliente).
  - Al **Mantener/hold** la venta → limpiar el carrito con `setCart([])` (mismo
    comportamiento actual; conservar la semántica que ya tiene el hold respecto
    al cliente).
- El resto del estado de `VentaScreen` (query, catFilter, mode, scanQty, modales:
  payOpen, pickerOpen, heldOpen, boletasOpen, cierreOpen, folioModal, etc.) sigue
  siendo `useState` local y transitorio: se resetea al navegar, que es el
  comportamiento esperado.

## Comportamiento resultante

- Agregar productos + elegir cliente → navegar a otro módulo → volver a Venta →
  carrito y cliente intactos.
- Se limpia al: cobrar la venta (`resetDraft`), hacer logout (provider se
  desmonta), o reiniciar la app (estado en memoria).
- Los precios/nombres se siguen derivando en vivo del catálogo (el carrito solo
  guarda `{ id, qty }`), así que al volver los datos están actualizados.

## Testing / verificación

- Verificación manejando la app: agregar ítems + cliente en Venta → ir a
  Cotizaciones → volver a Venta → confirmar que persisten. Confirmar que tras
  cobrar queda vacío y que logout lo limpia.
- Test liviano (Vitest + jsdom) opcional del `SaleDraftProvider`: un componente
  consumidor que setea el carrito y otro que lo lee montados bajo el mismo
  provider comparten el estado; `resetDraft()` lo vacía.

## Fuera de alcance

- Persistencia a disco (sobrevivir recargas/reinicio de la app).
- Limpiar el carrito al cerrar caja (se mantiene el comportamiento actual).
- Persistir estado transitorio de UI (búsqueda, filtros, modales).
