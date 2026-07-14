# Modo sin impresión + updater — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un modo local "sin impresión" (el equipo cobra y emite pero no imprime) y un updater de Tauri (buscar/instalar nuevas versiones vía GitHub Releases).

**Architecture:** Feature 1 = flag `localStorage` + guards en los call-sites de impresión automática (patrón `printerConfig.ts`). Feature 2 = `tauri-plugin-updater`/`tauri-plugin-process` (Rust+JS) + config `plugins.updater` (GitHub Releases + pubkey) + workflow CI con `tauri-action` + wrappers TS + UI. Dos fases independientes; Fase 1 primero.

**Tech Stack:** React 19 + Vite + TS, Tauri v2 (Rust `src-tauri/`), Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-14-modo-sin-impresion-y-updater-design.md`

## Global Constraints

- Prosa/UI en **español**; identificadores, funciones y flags en **inglés**.
- Commits **solo** como `Cromilakis <ipcromilakis@gmail.com>`; **prohibido** `Co-Authored-By` y atribución a Claude/Anthropic. Formato: `git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "…"`.
- **Nunca** `git add -A`; agregar por ruta explícita.
- **Secretos fuera del repo/cliente**: la clave privada de firma y los passwords NUNCA se commitean ni los maneja el asistente — van en GitHub Secrets, provistos por el usuario. La clave pública la provee el usuario; si no está disponible al implementar, usar el placeholder `PLACEHOLDER_UPDATER_PUBKEY` y documentar el reemplazo.
- `src-tauri/*` se modifica solo para habilitar el updater.
- Verificación por tarea: `pnpm build` y `pnpm test` verdes (frontend); `cargo check --manifest-path src-tauri/Cargo.toml` para cambios Rust (si el entorno no puede compilar por red, reportarlo, no inventar).
- Repo remoto: `github.com/cromilakis/kromi-pos`. Versión actual de la app: `0.1.0` (`package.json` y `src-tauri/tauri.conf.json`).

---

# FASE 1 — Modo sin impresión

### Task 1.1: Config local `deviceConfig`

**Files:**
- Create: `src/lib/deviceConfig.ts`
- Test: `src/lib/deviceConfig.test.ts`

**Interfaces:**
- Produces: `export function getSkipPrint(): boolean` y `export function setSkipPrint(v: boolean): void` (flag en `localStorage`, clave `kromi.skipPrint`).

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { getSkipPrint, setSkipPrint } from "./deviceConfig";

describe("deviceConfig skipPrint", () => {
  beforeEach(() => localStorage.clear());
  it("por defecto es false", () => { expect(getSkipPrint()).toBe(false); });
  it("round-trip true/false", () => {
    setSkipPrint(true); expect(getSkipPrint()).toBe(true);
    setSkipPrint(false); expect(getSkipPrint()).toBe(false);
  });
  it("valor corrupto se lee como false", () => {
    localStorage.setItem("kromi.skipPrint", "sí"); expect(getSkipPrint()).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm test -- deviceConfig`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

```ts
/** Ajuste local del equipo: si está activo, este dispositivo NO imprime comprobantes
 *  automáticamente (solo cobra y emite). Patrón idéntico a printerConfig.ts. */
const KEY = "kromi.skipPrint";

export function getSkipPrint(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setSkipPrint(v: boolean): void {
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* noop */ }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm test -- deviceConfig`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/deviceConfig.ts src/lib/deviceConfig.test.ts
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(config): flag local skipPrint (modo sin impresion)"
```

---

### Task 1.2: Toggle en Configuración + guards en las impresiones automáticas

**Files:**
- Modify: `src/modules/admin/BusinessSettings.tsx` (toggle junto a `PrinterSettings`, ~L120-126)
- Modify: `src/modules/venta/VentaScreen.tsx` (`handleConfirmPay`, ~L401)
- Modify: `src/modules/cotizaciones/CotizacionesScreen.tsx` (`handleConfirmCobro` ~L222 y `handleCrear` ~L141)
- Modify: `src/modules/notas-credito/NuevaNotaCredito.tsx` (`handleEmitir`, ~L158)
- Modify: `src/modules/cierre/CierrePanel.tsx` (`printCierre`, L154)

**Interfaces:**
- Consumes: `getSkipPrint`, `setSkipPrint` de `@/lib/deviceConfig` (Task 1.1).

- [ ] **Step 1: Toggle en `BusinessSettings.tsx`**

Import: `import { getSkipPrint, setSkipPrint } from "@/lib/deviceConfig";`. Estado local: `const [skipPrint, setSkipPrintState] = useState(() => getSkipPrint());`. Insertar, dentro de la tarjeta, justo antes del bloque de "Impresora de boletas" (línea ~120), este bloque:

```tsx
<div className="mt-4 flex items-center justify-between gap-3 border-t border-[#F0F2F7] pt-4">
  <div>
    <div className="text-[12.5px] font-bold text-[#5a6b7e]">Este dispositivo no imprime</div>
    <div className="text-[11.5px] text-[#5E6E7E]">Para tablets que solo cobran: la venta se emite igual; la boleta se imprime luego en la caja.</div>
  </div>
  <button
    type="button"
    role="switch"
    aria-checked={skipPrint}
    onClick={() => { const v = !skipPrint; setSkipPrintState(v); setSkipPrint(v); toast.success(v ? "Modo sin impresión activado." : "Impresión reactivada en este equipo."); }}
    className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors"
    style={{ background: skipPrint ? "var(--brand)" : "#CBD5E1" }}
  >
    <span className="absolute top-[3px] size-[20px] rounded-full bg-white transition-all" style={{ left: skipPrint ? "23px" : "3px" }} />
  </button>
</div>
```
(`toast` ya está importado en el archivo.)

- [ ] **Step 2: Guard en `VentaScreen.handleConfirmPay`**

Import: `import { getSkipPrint } from "@/lib/deviceConfig";`. En el bloque `if (dteFolio) { … }` (donde arma el payload y llama `await printReceipt(payload)`, ~L401), envolver la impresión:

```tsx
if (dteFolio) {
  if (getSkipPrint()) {
    toast.success(`Venta #${sale.folio} cobrada (boleta ${dteFolio}). Imprime desde «Boletas del día» en la caja.`);
  } else {
    const soldAt = new Date(sale.sold_at);
    const payload = { /* … payload existente sin cambios … */ };
    try {
      await printReceipt(payload);
    } catch (e) {
      notifyError(`Boleta emitida (folio ${dteFolio}) pero no se pudo imprimir. Reimprime desde «Boletas del día».`, e instanceof Error ? e.message : e);
    }
  }
}
```
(No cambiar el contenido del `payload`; solo agregar la rama `if (getSkipPrint())`.)

- [ ] **Step 3: Guard en `CotizacionesScreen`**

Import `getSkipPrint`. En `handleConfirmCobro`, la llamada a `printReceipt(...)` dentro de `if (dteFolio)` (~L222): envolver igual — si `getSkipPrint()`, `toast.success(\`Venta #${sale.folio} cobrada (boleta ${dteFolio}). Imprime desde «Boletas del día».\`)` y no imprimir; si no, imprimir como hoy. En `handleCrear`, la llamada `await printQuote({...})` (~L141): envolver en `if (!getSkipPrint())` (si se omite, no hay impresión; el `toast.success(\`Cotización #${quote.folio} generada.\`)` ya existe antes y se mantiene).

- [ ] **Step 4: Guard en `NuevaNotaCredito.handleEmitir`**

Import `getSkipPrint`. La llamada `await printCreditNote(...)` (~L158): envolver en `if (!getSkipPrint())`. Si se omite, `toast.success` informativo (p. ej. `\`Nota de crédito #${folio} emitida. Imprime desde el listado en la caja.\``) — reusar los datos ya disponibles en el handler.

- [ ] **Step 5: Guard en `CierrePanel`**

Import `getSkipPrint`. La llamada `await printCierre(payload)` (L154): envolver en `if (!getSkipPrint())`. El `toast.success("Caja cerrada.")` (L120) ya está antes y se mantiene sin cambios.

- [ ] **Step 6: Verificar build y tests**

Run: `pnpm build`
Expected: `✓ built` sin errores TS.
Run: `pnpm test`
Expected: PASS (sin regresiones).

Verificación manual (anotar en el reporte): con el toggle activo, cobrar una venta NO imprime pero aparece en «Boletas del día» y se reimprime; con el toggle inactivo, imprime como hoy.

- [ ] **Step 7: Commit**

```bash
git add src/modules/admin/BusinessSettings.tsx src/modules/venta/VentaScreen.tsx src/modules/cotizaciones/CotizacionesScreen.tsx src/modules/notas-credito/NuevaNotaCredito.tsx src/modules/cierre/CierrePanel.tsx
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(venta): modo sin impresion (toggle + guards en impresiones automaticas)"
```

---

# FASE 2 — Updater de Tauri

### Task 2.1: Backend Tauri — plugins, capability y config del updater

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Produces: los comandos del updater disponibles al frontend (vía el plugin) y los artefactos de actualización al empaquetar.

- [ ] **Step 1: Dependencias Rust (`Cargo.toml`)**

En `[dependencies]`, agregar tras `tauri-plugin-dialog = "2"`:
```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Registrar plugins (`src-tauri/src/lib.rs`)**

En el `Builder`, encadenar tras `.plugin(tauri_plugin_dialog::init())`:
```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```
(No tocar el `invoke_handler` ni los comandos existentes.)

- [ ] **Step 3: Capability (`src-tauri/capabilities/default.json`)**

Agregar a `permissions`:
```json
    "updater:default",
    "process:default"
```
(Quedando el array: `core:default`, `opener:default`, `dialog:default`, `updater:default`, `process:default`.)

- [ ] **Step 4: Config del updater y bundle (`src-tauri/tauri.conf.json`)**

Cambiar `bundle.targets` de `"all"` a `["nsis"]` y agregar `"createUpdaterArtifacts": true` dentro de `bundle`. Agregar un bloque `plugins` a nivel raíz (hermano de `app`/`bundle`):
```json
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/cromilakis/kromi-pos/releases/latest/download/latest.json"
      ],
      "pubkey": "PLACEHOLDER_UPDATER_PUBKEY"
    }
  }
```
> Si el usuario ya entregó la clave pública, reemplazar `PLACEHOLDER_UPDATER_PUBKEY` por ese valor. Si no, dejar el placeholder y anotarlo como pendiente en el reporte (el código compila; el updater no operará hasta poner la pubkey real).

- [ ] **Step 5: Verificar compilación Rust**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compila sin errores (descargará los crates nuevos; puede tardar). Si el entorno no tiene red para bajar crates, reportarlo como concern y dejar la verificación para el CI.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json src-tauri/tauri.conf.json src-tauri/Cargo.lock
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(tauri): habilitar updater (plugins, capability, config GitHub Releases)"
```

---

### Task 2.2: Frontend — dependencias JS y wrappers `updater.ts`

**Files:**
- Modify: `package.json` (deps)
- Create: `src/lib/updater.ts`
- Test: `src/lib/updater.test.ts`

**Interfaces:**
- Consumes: `@tauri-apps/plugin-updater` (`check`, tipo `Update`), `@tauri-apps/plugin-process` (`relaunch`).
- Produces:
  ```ts
  export async function checkForUpdate(): Promise<import("@tauri-apps/plugin-updater").Update | null>
  export async function installUpdate(update: import("@tauri-apps/plugin-updater").Update, onProgress?: (downloaded: number, total: number | null) => void): Promise<void>
  ```

- [ ] **Step 1: Instalar dependencias JS**

Run: `pnpm add @tauri-apps/plugin-updater@^2 @tauri-apps/plugin-process@^2`
Expected: se agregan a `package.json` dependencies.

- [ ] **Step 2: Test que falla**

```ts
import { describe, it, expect } from "vitest";
import { checkForUpdate } from "./updater";

describe("checkForUpdate", () => {
  it("fuera de Tauri retorna null (no lanza)", async () => {
    // En jsdom, window existe pero sin __TAURI_INTERNALS__.
    await expect(checkForUpdate()).resolves.toBeNull();
  });
});
```

- [ ] **Step 3: Verificar que falla**

Run: `pnpm test -- updater`
Expected: FAIL (módulo no existe).

- [ ] **Step 4: Implementar `src/lib/updater.ts`**

```ts
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Busca una actualización disponible. Fuera de Tauri (navegador/tests) retorna null. */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri) return null;
  return await check();
}

/** Descarga e instala la actualización (con progreso) y relanza la app. */
export async function installUpdate(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      onProgress?.(downloaded, total);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.(downloaded, total);
    }
  });
  await relaunch();
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `pnpm test -- updater`
Expected: PASS (1/1).
Run: `pnpm build`
Expected: `✓ built` sin errores TS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/updater.ts src/lib/updater.test.ts
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(updater): wrappers checkForUpdate/installUpdate + deps JS"
```

---

### Task 2.3: UI — sección "Actualizaciones" en Configuración

**Files:**
- Create: `src/shell/UpdateSettings.tsx`
- Modify: `src/modules/admin/BusinessSettings.tsx` (insertar `<UpdateSettings/>`)

**Interfaces:**
- Consumes: `checkForUpdate`, `installUpdate` de `@/lib/updater` (Task 2.2); `getVersion` de `@tauri-apps/api/app`; `notifyError`/`errMsg` de `@/lib/errors`; `toast`.
- Produces: `export function UpdateSettings(): JSX.Element`.

- [ ] **Step 1: Implementar `UpdateSettings.tsx`**

Componente autocontenido (patrón `PrinterSettings.tsx`). Estado: `version` (string, de `getVersion()` en un `useEffect`; fallback `"—"`), `status: "idle" | "checking" | "uptodate" | "available" | "installing"`, `update: Update | null`, `progress: { downloaded: number; total: number | null } | null`.

- Muestra "Versión actual: {version}".
- Botón **"Buscar actualizaciones"** (`disabled` si `checking`/`installing`) → `setStatus("checking")`; `try { const u = await checkForUpdate(); if (u) { setUpdate(u); setStatus("available"); } else { setStatus("uptodate"); } } catch (e) { notifyError("No se pudo buscar actualizaciones.", errMsg(e)); setStatus("idle"); }`.
- Si `status === "uptodate"`: texto "Estás en la última versión.".
- Si `status === "available"` y `update`: muestra `Nueva versión {update.version}` + notas (`update.body`) + botón **"Actualizar ahora"** → `setStatus("installing")`; `try { await installUpdate(update, (d, t) => setProgress({ downloaded: d, total: t })); } catch (e) { notifyError("No se pudo instalar la actualización.", errMsg(e)); setStatus("available"); }`. (Tras `installUpdate` la app se relanza; no hace falta más UI.)
- Si `status === "installing"` y `progress`: barra de progreso (`total` ? `${Math.round(downloaded/total*100)}%` : "Descargando…").

Usar clases/colores del proyecto (`var(--brand)`, `#E1E5EE`, `#0F2A1B`, `#556A7C`), consistente con `PrinterSettings`.

- [ ] **Step 2: Insertar en `BusinessSettings.tsx`**

`import { UpdateSettings } from "@/shell/UpdateSettings";`. Insertar un bloque tras el de "Impresora de boletas" (después de la línea ~126, antes del botón "Guardar cambios"):
```tsx
<div className="mt-4 border-t border-[#F0F2F7] pt-4">
  <div className="mb-2 text-[12.5px] font-bold text-[#5a6b7e]">Actualizaciones</div>
  <UpdateSettings />
</div>
```

- [ ] **Step 3: Verificar build y tests**

Run: `pnpm build`
Expected: `✓ built` sin errores TS.
Run: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shell/UpdateSettings.tsx src/modules/admin/BusinessSettings.tsx
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "feat(updater): seccion Actualizaciones en Configuracion"
```

---

### Task 2.4: CI de release (GitHub Actions + tauri-action)

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: secretos `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (los sube el usuario en GitHub → Settings → Secrets → Actions).

- [ ] **Step 1: Escribir el workflow**

```yaml
name: release
on:
  push:
    tags:
      - "v*"

jobs:
  release:
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - name: Instalar dependencias
        run: pnpm install --frozen-lockfile
      - name: Rust toolchain
        uses: dtolnay/rust-toolchain@stable
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Kromi POS ${{ github.ref_name }}"
          releaseBody: "Actualización de Kromi POS."
          releaseDraft: false
          prerelease: false
```

- [ ] **Step 2: Validar sintaxis YAML**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(!y.includes('tauri-action')) throw new Error('workflow incompleto'); console.log('yaml ok')"`
Expected: `yaml ok` (validación mínima; la ejecución real del workflow la verifica el usuario al pushear un tag).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git -c user.name='Cromilakis' -c user.email='ipcromilakis@gmail.com' commit --author='Cromilakis <ipcromilakis@gmail.com>' -m "ci: workflow de release con tauri-action (firma + GitHub Releases)"
```

---

## Trabajo del usuario para completar la Feature 2 (fuera del código)

1. Generar claves: `pnpm tauri signer generate -w "$HOME/.tauri/kromi-pos.key"`.
2. Entregar la **clave pública** para reemplazar `PLACEHOLDER_UPDATER_PUBKEY` en `tauri.conf.json`.
3. Subir a GitHub Secrets: `TAURI_SIGNING_PRIVATE_KEY` (contenido de la privada) y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Publicar releases con tags `vX.Y.Z` (bump de versión en `package.json` + `tauri.conf.json`). El botón "Buscar actualizaciones" encuentra algo desde el **segundo** release en adelante.

## Notas de ejecución

- Fase 1 es autónoma y verificable de inmediato (build + tests + verificación manual).
- Fase 2: el código y la config compilan y pasan tests, pero la **verificación e2e del updater** (detectar/instalar una versión) requiere 2 releases publicados y firmados — la coordina el usuario.
- Si `cargo check` no puede correr en el entorno (sin red para crates), no bloquea: el CI compila en `windows-latest`.
