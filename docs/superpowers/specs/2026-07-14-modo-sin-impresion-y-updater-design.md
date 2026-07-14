# Modo sin impresión + actualizaciones (updater) — Diseño

**Fecha:** 2026-07-14
**Estado:** aprobado (diseño), pendiente de plan de implementación

## Objetivo

Dos funcionalidades:

1. **Modo sin impresión** (ajuste local del equipo): un dispositivo (p. ej. una tablet) que **cobra y emite** la venta al SII pero **no imprime** el comprobante. La boleta se imprime después en la caja mediante la reimpresión ya existente.
2. **Actualizaciones de la app** (updater de Tauri): en Configuración, un botón "Buscar actualizaciones" y, si hay una nueva versión, poder descargarla e instalarla. Distribución vía GitHub Releases.

Ambas son independientes. Orden: **Feature 1 primero** (autónoma), luego Feature 2.

## Contexto del código actual (hallazgos)

- **Config local del equipo**: `src/lib/printerConfig.ts` establece el patrón — clave `kromi.*` en `localStorage`, getter/setter puros con try/catch, sin estado React. La UI de impresora (`src/shell/PrinterSettings.tsx`) es un botón+modal autocontenido, embebido en `src/modules/admin/BusinessSettings.tsx:9,125` (pestaña "Negocio" de `AdminScreen`).
- **Flujo de impresión** — `src/lib/print.ts`: `printReceipt`/`printQuote`/`printCreditNote`/`printCierre` invocan comandos Tauri (`print_receipt`, etc.) vía `safeInvoke` (no hace nada fuera de Tauri). Puntos de impresión **automática** (emisión/generación):
  - `src/modules/venta/VentaScreen.tsx` `handleConfirmPay` (~L401): `printReceipt` tras emitir boleta, solo si `dteFolio`.
  - `src/modules/cotizaciones/CotizacionesScreen.tsx` `handleConfirmCobro` (~L222): `printReceipt` tras cobrar cotización; `handleCrear` (~L141): `printQuote` al generar cotización.
  - `src/modules/notas-credito/NuevaNotaCredito.tsx` `handleEmitir` (~L158): `printCreditNote` tras emitir NC.
  - `src/modules/cierre/CierrePanel.tsx`: `printCierre` al cerrar caja (si aplica).
  - Puntos de **reimpresión manual** (NO se tocan): `VentaScreen.reimprimirBoleta` ("Boletas del día"), `HistorialScreen` (reimprimir), `NotasCreditoScreen` (reimprimir NC), `CotizacionesScreen.handlePrint` (reimprimir cotización).
- **Updater**: NO existe. `src-tauri/tauri.conf.json` sin bloque `updater`/`plugins`; `identifier: com.kromi.kromi-pos`, `version: 0.1.0`, `bundle.targets: "all"`, sin firma. `src-tauri/Cargo.toml` tiene `tauri-plugin-opener` y `tauri-plugin-dialog` (no updater). `src-tauri/src/lib.rs` registra plugins y comandos con `invoke_handler(generate_handler![...])`. `package.json`: Tauri v2 (`@tauri-apps/api ^2.11.1`), sin plugin-updater. `capabilities/default.json` otorga `core:default`, `opener:default`, `dialog:default`. Único workflow: `.github/workflows/pages.yml` (publica el prototipo web, no compila Tauri). Repo remoto: `github.com/cromilakis/kromi-pos`.

---

# Feature 1 — Modo sin impresión

## Config local

**Archivo nuevo** `src/lib/deviceConfig.ts` (patrón idéntico a `printerConfig.ts`):
```ts
const KEY = "kromi.skipPrint";
export function getSkipPrint(): boolean { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } }
export function setSkipPrint(v: boolean): void { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* noop */ } }
```

## UI

En `BusinessSettings.tsx`, junto a `<PrinterSettings/>`, un **toggle** "Este dispositivo no imprime (solo cobra)" con estado inicial `getSkipPrint()` y `onChange` → `setSkipPrint(v)`. Texto de ayuda breve: *"Úsalo en tablets que acompañan al cliente: la venta se cobra y emite igual; la boleta se imprime después desde la caja."*

## Intercepción (alcance: toda impresión automática)

Envolver cada llamada de impresión **automática** con el guard del flag. Punto de decisión en el call-site (no en `print.ts`, para no afectar las reimpresiones que pasan por las mismas funciones):

- `VentaScreen.handleConfirmPay`: la llamada `printReceipt(payload)` dentro del bloque `if (dteFolio)` se ejecuta solo `if (!getSkipPrint())`. Si se omite, `toast.success` informativo: *"Venta #N cobrada (boleta {dteFolio}). Imprime desde «Boletas del día» en la caja."*
- `CotizacionesScreen.handleConfirmCobro`: idem con `printReceipt`.
- `CotizacionesScreen.handleCrear`: `printQuote` solo `if (!getSkipPrint())`; si se omite, toast *"Cotización #N generada."* (sin el mensaje de impresión).
- `NuevaNotaCredito.handleEmitir`: `printCreditNote` solo `if (!getSkipPrint())`; si se omite, toast informativo de NC emitida.
- `CierrePanel`: si imprime el cierre automáticamente, `printCierre` solo `if (!getSkipPrint())`.

La venta/boleta/NC **se emiten igual** al SII; solo se omite el papel. Las **reimpresiones manuales** ignoran el flag (siempre imprimen), que es el uso en la caja.

## Testing (Feature 1)

- Unit: `getSkipPrint`/`setSkipPrint` (round-trip, default false, valor corrupto → false) con un mock de `localStorage`.
- Verificación manual: con el flag activo, cobrar una venta NO imprime pero la boleta aparece en «Boletas del día» y se puede reimprimir; con el flag inactivo, imprime como hoy.

---

# Feature 2 — Actualizaciones (updater de Tauri)

Distribución vía **GitHub Releases**. El código y la config los implementamos; las **claves de firma y los releases** los provee el usuario (secretos/distribución — límite de autonomía).

## Componentes a implementar (código/config)

1. **Rust** (`src-tauri/Cargo.toml` + `src-tauri/src/lib.rs`): agregar `tauri-plugin-updater = "2"` y `tauri-plugin-process = "2"`; registrar `.plugin(tauri_plugin_updater::Builder::new().build())` y `.plugin(tauri_plugin_process::init())` en el `Builder`.
2. **JS** (`package.json`): agregar `@tauri-apps/plugin-updater` y `@tauri-apps/plugin-process` (versión `^2`).
3. **Capability** (`src-tauri/capabilities/default.json`): agregar `updater:default` (y `process:default` si el relaunch lo requiere).
4. **Config del updater** (`src-tauri/tauri.conf.json`):
   - `plugins.updater`: `{ "endpoints": ["https://github.com/cromilakis/kromi-pos/releases/latest/download/latest.json"], "pubkey": "<CLAVE_PÚBLICA_DEL_USUARIO>" }`.
   - `bundle.createUpdaterArtifacts: true`.
   - Acotar `bundle.targets` a `["nsis"]` (Windows; NSIS es el target recomendado para el updater).
5. **CI de release** (`.github/workflows/release.yml`): workflow con `tauri-apps/tauri-action` disparado en push de tag `v*`; compila el bundle de Windows, firma los artefactos con los secretos `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, y publica un GitHub Release con los instaladores + `latest.json`.
6. **Capa de datos** `src/lib/updater.ts`: wrappers finos sobre el plugin — `checkForUpdate()` → `Update | null` (usa `check()` de `@tauri-apps/plugin-updater`), y `installUpdate(update, onProgress)` → `downloadAndInstall` + `relaunch()` de `@tauri-apps/plugin-process`. Defensivo fuera de Tauri (igual que `safeInvoke`): si no está en Tauri, `checkForUpdate` retorna null.
7. **UI** — sección "Actualizaciones" en Configuración (en `BusinessSettings.tsx`, junto a impresora / modo sin impresión): muestra la **versión actual** (de `@tauri-apps/api/app` `getVersion()`), botón **"Buscar actualizaciones"** → `checkForUpdate()`. Estados: "buscando…", "estás al día" (sin update), o "nueva versión X disponible" con notas (`update.body`) y botón **"Actualizar"** → `installUpdate` con barra de progreso (bytes descargados) → relaunch. Errores con `notifyError`.

## Trabajo del usuario (prerequisitos de firma/distribución)

1. Generar el par de claves: `pnpm tauri signer generate -w $HOME/.tauri/kromi-pos.key` (guardar la privada + password de forma segura; **no** al repo).
2. Entregar la **clave pública** para ponerla en `tauri.conf.json` (`plugins.updater.pubkey`).
3. Subir a GitHub → Settings → Secrets and variables → Actions: `TAURI_SIGNING_PRIVATE_KEY` (contenido del archivo de clave privada) y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Publicar el primer release: bump de versión + tag `vX.Y.Z` → el CI compila y publica. El updater compara versiones, así que **solo encuentra actualización a partir del segundo release** (uno con versión mayor a la instalada).

> Si el usuario aún no generó la clave al momento de implementar, `pubkey` queda con un placeholder claramente marcado y el paso queda documentado; el código compila, pero el updater no operará hasta completar la config.

## Testing (Feature 2)

- Unit: `checkForUpdate` retorna null fuera de Tauri (mock del entorno). La UI renderiza "estás al día" cuando `check()` devuelve null.
- Verificación e2e (la coordina el usuario, requiere 2 releases publicados): instalar la versión N, publicar N+1, pulsar "Buscar actualizaciones" → detecta N+1 → "Actualizar" descarga, instala y relanza en N+1.

---

## Restricciones globales

- Prosa/UI en español; identificadores/flags/nombres en inglés.
- Commits exclusivamente como `Cromilakis <ipcromilakis@gmail.com>`; prohibido `Co-Authored-By` y atribución a Claude/Anthropic.
- Nunca `git add -A`.
- **Secretos fuera del cliente y del repo**: la clave privada de firma y los passwords NUNCA se commitean ni se manejan por el asistente; van en GitHub Secrets, provistos por el usuario.
- `src-tauri/*` se modifica en esta iniciativa (Feature 2 lo requiere): dependencias, registro de plugins, config y capabilities. Cambios acotados a habilitar el updater.
- La firma/distribución de instaladores y la generación de claves son acciones del usuario.

## Fuera de alcance (YAGNI)

- Actualización automática silenciosa en el arranque (solo búsqueda manual por botón).
- Firma de código del ejecutable (certificado Windows anti-SmartScreen) — requiere comprar certificado; el updater usa su firma minisign propia.
- Canales de release (beta/stable), rollback de versiones, o updates diferenciales.
- Targets no-Windows (macOS/Linux) en el CI — se acota a Windows, plataforma del POS.
