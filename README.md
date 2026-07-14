# Mostrador POS

Punto de venta (POS) **white-label** empaquetado como app de escritorio con **Tauri 2**
(macOS/Windows). Configuración de demo: marca de vivero, CLP, IVA 19%.

Generado con el plugin **kromi-foundry** (`/kromi`, target `tauri`) y portado desde el
prototipo funcional del diseño (`Mostrador POS.dc.html`).

## Stack

- **Shell:** Tauri 2 (Rust) — `src-tauri/`.
- **Frontend:** estático en `src/` (`index.html` autocontenido del prototipo + `support.js`,
  el runtime de design-canvas). React 18 y Babel standalone van **vendoreados** en
  `src/vendor/` para correr sin red.
- **Datos:** en memoria (sin backend; no persisten entre recargas), según el alcance del
  prototipo.

## Correr

```bash
pnpm install
pnpm tauri dev      # ventana de desarrollo
pnpm tauri build    # instalable
```

Cuentas demo (el RUT es la credencial): `11.111.111-1` administrador · `22.222.222-2` cajero.

## Estructura

- `src/index.html` — prototipo completo (login, venta, stock, clientes, cierre, historial,
  categorías, usuarios, configuración, respaldo).
- `src/vendor/` — React/ReactDOM/Babel UMD (offline).
- `src/uploads/` — imágenes de producto del catálogo.
- `.kromi/` — documentos contrato del flujo Kromi (`init.md`, `design.md`).
