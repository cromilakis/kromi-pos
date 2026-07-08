# Fix layout del carrito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El panel de totales del carrito (Subtotal, IVA, Total, Cobrar) queda fijo abajo y sólo la lista de ítems hace scroll cuando hay muchos productos.

**Architecture:** El `Cart` ya está bien estructurado (lista `min-h-0 flex-1 overflow-auto` + totales en bloque `border-t`). El defecto está en la cadena de altura: `AppLayout` usa `min-h-full` en su contenedor raíz, que no ancla la altura al viewport, por lo que `main` (`flex-1 overflow-auto`) no queda acotado y `VentaScreen`/`Cart` crecen con su contenido. Se cambia el contenedor raíz a altura fija de viewport.

**Tech Stack:** React + Vite + TypeScript, Tailwind CSS v4.

## Global Constraints

- Prosa en español; identificadores/código en inglés.
- Gestor de paquetes: **pnpm**.
- Build del frontend: `pnpm build` (`tsc -b && vite build`).
- Identidad de commits: autor y committer `Cromilakis <ipcromilakis@gmail.com>`; sin `Co-Authored-By` ni atribución a Claude.
- Este sub-proyecto es sólo frontend/CSS; no toca base de datos.

---

### Task 1: Anclar la altura del layout al viewport

**Files:**
- Modify: `src/shell/AppLayout.tsx:72`
- Reference (sin cambios esperados): `src/modules/venta/Cart.tsx`, `src/index.css:44`

**Interfaces:**
- Consumes: `html, body, #root { height: 100%; }` ya definido en `src/index.css:44`.
- Produces: contenedor raíz de la app con altura fija de viewport; ningún símbolo nuevo exportado.

- [ ] **Step 1: Reproducir el defecto (línea base)**

Ejecutar el frontend y confirmar el bug antes de tocar nada:

```bash
pnpm dev
```

En el navegador: entrar a **Venta** (abrir caja si hace falta) y agregar suficientes productos al carrito hasta superar el alto visible. Observar que el bloque de totales (Subtotal/IVA/Total/Cobrar) se desplaza hacia abajo y/o el scroll ocurre en la página completa en vez de dentro de la lista del carrito.

Expected: se reproduce el desplazamiento de los totales.

- [ ] **Step 2: Aplicar el fix en AppLayout**

En `src/shell/AppLayout.tsx`, contenedor raíz del `return` de `AppLayout` (línea 72), cambiar `min-h-full` por `h-full`:

```tsx
// Antes:
//   <div className="min-h-full flex">
// Después:
    <div className="h-full flex">
```

(El resto del componente queda igual: `aside` con `w-[236px] shrink-0 ... flex flex-col`, y la columna de contenido `flex-1 flex flex-col overflow-hidden` con `<main className="flex-1 overflow-auto">`.)

- [ ] **Step 3: Verificar que compila**

Run: `pnpm build`
Expected: `tsc -b` sin errores y `vite build` genera `dist/` sin fallos.

- [ ] **Step 4: Verificación manual del carrito**

Run: `pnpm dev`

Comprobar en **Venta**:
- Con el carrito lleno (más ítems que el alto visible), el bloque de totales queda **fijo** en la parte inferior del panel.
- Sólo la **lista de ítems** del carrito hace scroll; los totales no se mueven.

Expected: totales fijos, scroll contenido en la lista.

- [ ] **Step 5: Verificación de regresión en otras pantallas**

Con `pnpm dev` abierto, recorrer y confirmar que siguen scrolleando bien dentro del área de contenido (no se cortan ni desaparece contenido):
- **Stock e inventario** (lista larga de productos).
- **Clientes**.
- **Inicio**.
- **Administración** (si el rol lo permite).

Expected: cada pantalla scrollea dentro de `main`; el sidebar permanece fijo.

- [ ] **Step 6: Commit**

```bash
git add src/shell/AppLayout.tsx
GIT_AUTHOR_NAME="Cromilakis" GIT_AUTHOR_EMAIL="ipcromilakis@gmail.com" \
GIT_COMMITTER_NAME="Cromilakis" GIT_COMMITTER_EMAIL="ipcromilakis@gmail.com" \
git commit -m "fix(venta): anclar altura del layout para fijar totales del carrito

AppLayout usaba min-h-full en la raiz, rompiendo la cadena de altura: el
main no quedaba acotado y el carrito empujaba los totales. Se cambia a
h-full para que el scroll quede contenido en cada panel."
```

---

## Notas de verificación

Este sub-proyecto es un cambio de layout CSS; no admite un test unitario significativo. La verificación es manual (Steps 4-5) más el gate de build (Step 3). Si al fijar la altura alguna pantalla concreta se cortara (p. ej. un contenedor hijo con `h-full` sin `overflow` propio), se corrige acotando esa pantalla, pero no se anticipa: las pantallas actuales usan `min-h-full overflow-auto` dentro de `main`, compatible con el layout anclado.
