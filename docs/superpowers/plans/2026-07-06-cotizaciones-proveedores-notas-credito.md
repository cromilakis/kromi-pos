# Cotizaciones, Proveedores y Notas de crédito — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar tres módulos core a kromi-pos: cotizaciones (imprimir/PDF/convertir a venta), mantención de proveedores (CRUD + asociación opcional a productos) y notas de crédito (devolución que afecta la caja del turno y se ve en el cierre sin contarse como pérdida).

**Architecture:** Todo el frontend vive en el único componente React de clase de `src/index.html` (estado en memoria, plantillas `sc-if`/`sc-for`, bindings `{{ }}`). Se agregan claves de estado, métodos-handler (class properties arrow) y bindings en el objeto de props del `render`, más bloques de plantilla nuevos. La impresión térmica se agrega como comandos Tauri en Rust (`src-tauri/src/`), espejo de `print_receipt`/`print_cierre`. El "enviar/PDF" de cotización es print-to-PDF del navegador sobre una vista A4 (sin backend, sin dependencias).

**Tech Stack:** Tauri 2, Rust (ESC/POS a mano), React 18 (vendored) + Babel en navegador, pnpm.

## Global Constraints

- Prosa/UI en español; identificadores, claves y flags en inglés.
- Estado en memoria (datos mock). Sin backend, sin persistencia en disco, sin dependencias JS nuevas.
- Roles: `admin`/`kromi` (isAdmin) y `cajero`. Cotizaciones: ambos roles. Proveedores y Notas de crédito: solo admin.
- Impresión: comandos Tauri con fallback a `window.print()` cuando `window.__TAURI__` no existe (patrón actual, ver `printCierre` en `src/index.html:2516`).
- Notas de crédito requieren caja abierta (se atan al `cajaSessionId` actual).
- Cotización: vigencia por defecto **7 días**.
- PDF de cotización: **Opción A** (vista A4 + `window.print()`), sin Rust.
- No romper el patrón de estilos inline existente; al crear markup nuevo, imitar el panel/modal hermano citado en cada tarea.

## Reconciliación previa (obligatoria antes de la Fase A)

Hay cambios sin commitear en `src-tauri/src/escpos.rs`, `src-tauri/src/printing.rs`, `src-tauri/tauri.conf.json`, `src/index.html`. Este plan asume que esos cambios están estabilizados/commiteados. **No empezar** hasta resolver la Tarea 0.

---

## Mapa de archivos

- `src/index.html` — TODO el frontend (estado, handlers, bindings, plantilla). Único archivo tocado en frontend.
- `src-tauri/src/escpos.rs` — structs de payload + `build_quote` + `build_credit_note` + tests.
- `src-tauri/src/lib.rs` — comandos `print_quote` / `print_credit_note` + registro en `invoke_handler`.
- `docs/superpowers/specs/2026-07-06-cotizaciones-proveedores-notas-credito-design.md` — spec de referencia.

Anclas útiles en `src/index.html` (pueden desplazarse; buscar por nombre):
- Estado inicial (`this.state = {`): `ventaView` ~2177, `custForm: null` ~2201, `prodForm: null` ~2203, `sales:` ~2247.
- Handlers: `setScreen` ~2389, `doCierre` ~2465, `buildCierrePayload` ~2492, `printCierre` ~2516, `saveProduct` ~2765, `openAddCustomer` ~2874, `saveCustomer` ~2878.
- Render: `tabDefs` ~2946, `adminScreens` ~2960, `adminMenuDefs` ~2961, objeto de bindings ~3437–3600.
- Plantilla: historial+tabs ~780–960, cierre ~1155–1230, form producto ~1690–1702, modal cliente ~1750–1790, modal pago ~1500–1540, modal confirmar cierre ~1966.

---

# FASE A — Proveedores (solo admin)

Módulo más aislado: nueva pantalla admin con CRUD y asociación opcional a productos.

### Task A1: Estado y semilla de proveedores

**Files:**
- Modify: `src/index.html` (objeto `this.state`, junto a las otras colecciones ~2100–2246)

**Interfaces:**
- Produces: `state.suppliers: Array<{id, razonSocial, rut, giro, contactName, phone, email, address, website, payTerms:'contado'|'30'|'60'|'90', category, bank, account, notes, active:boolean}>`; `state.supForm: null | (supplier form object with same fields, `id:null` al crear)`; `state.supQuery: string`.

- [ ] **Step 1: Agregar claves de estado**

En el objeto `this.state = { ... }`, junto a `custForm: null` (~2201), agregar:

```js
      supForm: null,
      supQuery: '',
      suppliers: [
        { id: 'sup1', razonSocial: 'Viveros del Sur SpA', rut: '76.543.210-K', giro: 'Producción de plantas', contactName: 'Carla Muñoz', phone: '+56 9 8123 4567', email: 'ventas@viverosdelsur.cl', address: 'Camino El Alba 4210, Puente Alto', website: 'viverosdelsur.cl', payTerms: '30', category: 'Plantas', bank: 'Banco Estado', account: 'Cta Cte 12345678', notes: 'Despacha martes y viernes.', active: true },
        { id: 'sup2', razonSocial: 'Insumos Verdes Ltda.', rut: '77.888.999-1', giro: 'Sustratos y macetas', contactName: 'Diego Rivas', phone: '+56 2 2765 4321', email: 'contacto@insumosverdes.cl', address: 'Av. Industrial 980, Maipú', website: 'insumosverdes.cl', payTerms: 'contado', category: 'Insumos', bank: 'Banco de Chile', account: 'Cta Vista 98765432', notes: '', active: true },
        { id: 'sup3', razonSocial: 'Herramientas Andes', rut: '78.111.222-3', giro: 'Herramientas de jardín', contactName: 'Paula Soto', phone: '+56 9 7654 3210', email: 'psoto@handes.cl', address: 'Ruta 5 Sur Km 12, San Bernardo', website: '', payTerms: '60', category: 'Herramientas', bank: '', account: '', notes: 'Pedido mínimo $50.000.', active: false },
      ],
```

- [ ] **Step 2: Verificar carga**

Run: `cd C:/Kromi/kromi-pos && pnpm tauri dev`
Expected: la app abre sin errores en consola (F12). Aún no hay UI de proveedores; solo se valida que el estado no rompe el render.

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "feat(proveedores): estado y semilla de proveedores"
```

---

### Task A2: Handlers de proveedores (CRUD)

**Files:**
- Modify: `src/index.html` (zona de handlers, junto a `saveCustomer` ~2878)

**Interfaces:**
- Consumes: `state.suppliers`, `state.supForm`, `state.supQuery` (Task A1).
- Produces: métodos `openAddSupplier()`, `openEditSupplier(id)`, `closeSupForm()`, `onSupField(field, value)`, `saveSupplier()`, `toggleSupplierActive(id)`, `onSupQuery(e)`. `nextSupId()` interno.

- [ ] **Step 1: Agregar los handlers**

Junto a `saveCustomer` (~2878) agregar como class properties:

```js
  onSupQuery = (e) => this.setState({ supQuery: e.target.value });
  openAddSupplier = () => this.setState({ supForm: { id: null, razonSocial: '', rut: '', giro: '', contactName: '', phone: '', email: '', address: '', website: '', payTerms: 'contado', category: '', bank: '', account: '', notes: '', active: true } });
  openEditSupplier = (id) => { const s = this.state.suppliers.find(x => x.id === id); if (!s) return; this.setState({ supForm: { ...s } }); };
  closeSupForm = () => this.setState({ supForm: null });
  onSupField = (field, value) => this.setState(s => ({ supForm: { ...s.supForm, [field]: value } }));
  toggleSupplierActive = (id) => this.setState(s => ({ suppliers: s.suppliers.map(x => x.id === id ? { ...x, active: !x.active } : x) }));
  saveSupplier = () => {
    const f = this.state.supForm;
    if (!f) return;
    const razonSocial = (f.razonSocial || '').trim();
    if (!razonSocial) { return; } // razón social obligatoria; el botón ya va deshabilitado
    this.setState(s => {
      const clean = { ...f, razonSocial, rut: this.fmtRut(this.normRut(f.rut)) };
      if (!f.id) {
        const id = 'sup' + (s.suppliers.reduce((m, x) => Math.max(m, parseInt((x.id || '').replace('sup', ''), 10) || 0), 0) + 1);
        return { suppliers: [...s.suppliers, { ...clean, id }], supForm: null };
      }
      return { suppliers: s.suppliers.map(x => x.id === f.id ? { ...clean } : x), supForm: null };
    });
  };
```

- [ ] **Step 2: Verificar sin errores de sintaxis**

Run: `pnpm tauri dev` (o recargar la ventana con Ctrl+R si ya está abierta)
Expected: sin errores de Babel en consola. Los handlers aún no se invocan desde UI.

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "feat(proveedores): handlers CRUD (crear/editar/activar)"
```

---

### Task A3: Pantalla Proveedores en el menú admin

**Files:**
- Modify: `src/index.html` (`adminScreens` ~2960, `adminMenuDefs` ~2961, bloque de plantilla nuevo, bindings del render)

**Interfaces:**
- Consumes: handlers de A2, `state.suppliers`, `state.supQuery`.
- Produces: pantalla `screen === 'proveedores'` accesible desde el menú admin; bindings `isProveedores`, `supRows`, `supQueryVal`, `openAddSupplier`, `onSupQuery`.

- [ ] **Step 1: Registrar la pantalla en el menú admin**

En `adminScreens` (~2960) agregar `'proveedores'`:

```js
    const adminScreens = ['historial', 'metricas', 'cajeros', 'config', 'respaldo', 'proveedores'];
```

En `adminMenuDefs` (~2961), agregar una entrada (icono estilo camión) después de `['cajeros', 'Personal', ...]`:

```js
      ['proveedores', 'Proveedores', mIcon([pth('M1 3h15v13H1z'), pth('M16 8h4l3 3v5h-7z'), cE('circle', { cx: 5.5, cy: 18.5, r: 1.5, key: 'a' }), cE('circle', { cx: 18.5, cy: 18.5, r: 1.5, key: 'b' })])],
```

- [ ] **Step 2: Agregar bindings en el objeto de props del render**

En el objeto de bindings (~3437–3600) agregar:

```js
      isProveedores: S.screen === 'proveedores',
      openAddSupplier: this.openAddSupplier,
      onSupQuery: this.onSupQuery,
      supQueryVal: S.supQuery,
      supRows: S.suppliers
        .filter(x => {
          const q = (S.supQuery || '').toLowerCase().trim();
          if (!q) return true;
          return (x.razonSocial + ' ' + x.rut + ' ' + x.category + ' ' + x.contactName).toLowerCase().includes(q);
        })
        .map(x => ({
          id: x.id,
          razonSocial: x.razonSocial,
          meta: [x.category, x.rut].filter(Boolean).join(' · ') || '—',
          contact: [x.contactName, x.phone].filter(Boolean).join(' · ') || 'Sin contacto',
          payLabel: ({ contado: 'Contado', '30': '30 días', '60': '60 días', '90': '90 días' })[x.payTerms] || x.payTerms,
          active: x.active,
          statusStyle: { fontSize: '11.5px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: x.active ? '#E6F7EE' : '#F0F2F7', color: x.active ? '#0a6e36' : '#9aa8bd', whiteSpace: 'nowrap' },
          statusLabel: x.active ? 'Activo' : 'Inactivo',
          onEdit: () => this.openEditSupplier(x.id),
          onToggle: () => this.toggleSupplierActive(x.id),
        })),
```

- [ ] **Step 3: Agregar el bloque de plantilla de la pantalla**

Justo después del bloque de la pantalla `config`/`respaldo` (buscar el último `sc-if` de una pantalla admin, alrededor de ~1240), agregar un bloque nuevo. Imitar el patrón de tarjetas de la lista de cierres (`src/index.html:882–927`) para el estilo:

```html
    <!-- ---------- PROVEEDORES ---------- -->
    <sc-if value="{{ isProveedores }}" hint-placeholder-val="{{ false }}">
    <div data-screen-label="Proveedores" style="position:absolute;inset:0;overflow:auto;padding:28px 32px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px;">
        <div style="flex:1;">
          <h2 style="font-size:26px;font-weight:900;color:#0F2A1B;margin:0 0 4px;letter-spacing:-.01em;">Proveedores</h2>
          <p style="font-size:14px;color:#7C95A8;margin:0;">Directorio de proveedores del negocio.</p>
        </div>
        <button onClick="{{ openAddSupplier }}" style="border:0;background:var(--accent);color:#fff;border-radius:12px;padding:12px 18px;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer;">+ Nuevo proveedor</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #E1E5EE;border-radius:12px;padding:10px 14px;margin-bottom:18px;">
        <input value="{{ supQueryVal }}" onInput="{{ onSupQuery }}" placeholder="Buscar por nombre, RUT, categoría…" style="flex:1;border:0;outline:none;font-family:inherit;font-size:14px;color:#0F2A1B;background:transparent;" />
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <sc-for list="{{ supRows }}" as="s" hint-placeholder-count="3">
          <div style="display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #E1E5EE;border-radius:14px;padding:16px 18px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:15px;font-weight:800;color:#0F2A1B;">{{ s.razonSocial }}</div>
              <div style="font-size:12.5px;color:#7C95A8;margin-top:2px;">{{ s.meta }}</div>
              <div style="font-size:12.5px;color:#7C95A8;margin-top:2px;">{{ s.contact }} · Pago: {{ s.payLabel }}</div>
            </div>
            <span style="{{ s.statusStyle }}">{{ s.statusLabel }}</span>
            <button onClick="{{ s.onToggle }}" style="border:1px solid #E1E5EE;background:#fff;color:#5a6b7e;border-radius:10px;padding:8px 12px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;">{{ s.statusLabel }}</button>
            <button onClick="{{ s.onEdit }}" style="border:1px solid var(--accent);background:#fff;color:#0a6e36;border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;">Editar</button>
          </div>
        </sc-for>
      </div>
    </div>
    </sc-if>
```

> Nota: el `s.onToggle` muestra el estado actual como label del botón; si prefieres “Activar/Desactivar” explícito, añade `toggleLabel: x.active ? 'Desactivar' : 'Activar'` al binding y úsalo. Se deja simple por ahora.

- [ ] **Step 4: Verificación manual**

Run: `pnpm tauri dev`
- Iniciar sesión como admin.
- Abrir el menú admin → "Proveedores".
Expected: se ve la pantalla con los 3 proveedores semilla, el buscador filtra, y el botón de estado alterna Activo/Inactivo.

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat(proveedores): pantalla de directorio en menú admin"
```

---

### Task A4: Modal de ficha de proveedor (crear/editar)

**Files:**
- Modify: `src/index.html` (modal nuevo junto al modal de cliente ~1750–1790, bindings del render)

**Interfaces:**
- Consumes: `openAddSupplier`/`openEditSupplier`/`saveSupplier`/`closeSupForm`/`onSupField`, `state.supForm`.
- Produces: bindings `supFormOpen`, `supFormTitle`, `supForm*` (uno por campo), `onSup<Field>`, `saveSupplier`, `closeSupForm`, `saveSupStyle`, `saveSupDisabled`.

- [ ] **Step 1: Agregar bindings del formulario**

En el objeto de bindings del render agregar:

```js
      supFormOpen: !!S.supForm,
      supFormTitle: (S.supForm && S.supForm.id) ? 'Editar proveedor' : 'Nuevo proveedor',
      closeSupForm: this.closeSupForm,
      saveSupplier: this.saveSupplier,
      supFRazon: S.supForm ? S.supForm.razonSocial : '',
      supFRut: S.supForm ? S.supForm.rut : '',
      supFGiro: S.supForm ? S.supForm.giro : '',
      supFContact: S.supForm ? S.supForm.contactName : '',
      supFPhone: S.supForm ? S.supForm.phone : '',
      supFEmail: S.supForm ? S.supForm.email : '',
      supFAddress: S.supForm ? S.supForm.address : '',
      supFWebsite: S.supForm ? S.supForm.website : '',
      supFPayTerms: S.supForm ? S.supForm.payTerms : 'contado',
      supFCategory: S.supForm ? S.supForm.category : '',
      supFBank: S.supForm ? S.supForm.bank : '',
      supFAccount: S.supForm ? S.supForm.account : '',
      supFNotes: S.supForm ? S.supForm.notes : '',
      onSupRazon: (e) => this.onSupField('razonSocial', e.target.value),
      onSupRut: (e) => this.onSupField('rut', e.target.value),
      onSupGiro: (e) => this.onSupField('giro', e.target.value),
      onSupContact: (e) => this.onSupField('contactName', e.target.value),
      onSupPhone: (e) => this.onSupField('phone', e.target.value),
      onSupEmail: (e) => this.onSupField('email', e.target.value),
      onSupAddress: (e) => this.onSupField('address', e.target.value),
      onSupWebsite: (e) => this.onSupField('website', e.target.value),
      onSupPayTerms: (e) => this.onSupField('payTerms', e.target.value),
      onSupCategory: (e) => this.onSupField('category', e.target.value),
      onSupBank: (e) => this.onSupField('bank', e.target.value),
      onSupAccount: (e) => this.onSupField('account', e.target.value),
      onSupNotes: (e) => this.onSupField('notes', e.target.value),
      saveSupDisabled: !(S.supForm && (S.supForm.razonSocial || '').trim()),
      saveSupStyle: { flex: 1, border: 0, borderRadius: 12, padding: '13px 18px', fontWeight: 700, fontSize: 15, fontFamily: 'inherit', cursor: (S.supForm && (S.supForm.razonSocial || '').trim()) ? 'pointer' : 'not-allowed', color: '#fff', background: (S.supForm && (S.supForm.razonSocial || '').trim()) ? 'var(--accent)' : '#c9d3df' },
```

- [ ] **Step 2: Agregar el modal en la plantilla**

Junto al modal de cliente (`custFormOpen`, ~1750) agregar un modal nuevo. Reusar exactamente el patrón de overlay/campos del modal de cliente (mismo estilo de `input`/`label`). Campos: razón social, RUT, giro, categoría, contacto, teléfono, email, dirección, sitio web, condiciones de pago (`select`: Contado/30/60/90), banco, cuenta, notas (`textarea`).

```html
  <sc-if value="{{ supFormOpen }}" hint-placeholder-val="{{ false }}">
  <div style="position:absolute;inset:0;background:rgba(15,42,27,.35);display:flex;align-items:center;justify-content:center;z-index:60;padding:24px;">
    <div style="width:520px;max-width:100%;max-height:90%;overflow:auto;background:#fff;border-radius:20px;padding:26px 28px;box-shadow:0 24px 60px rgba(0,0,0,.25);">
      <div style="display:flex;align-items:center;margin-bottom:18px;">
        <div style="font-weight:900;font-size:19px;color:#0F2A1B;flex:1;">{{ supFormTitle }}</div>
        <button onClick="{{ closeSupForm }}" style="border:0;background:#F0F2F7;color:#5a6b7e;border-radius:9px;width:32px;height:32px;cursor:pointer;font-family:inherit;font-weight:700;font-size:16px;">×</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Razón social *</label><input value="{{ supFRazon }}" onInput="{{ onSupRazon }}" placeholder="Ej. Viveros del Sur SpA" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
        <div style="display:flex;gap:10px;">
          <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">RUT</label><input value="{{ supFRut }}" onInput="{{ onSupRut }}" placeholder="76.543.210-K" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
          <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Categoría</label><input value="{{ supFCategory }}" onInput="{{ onSupCategory }}" placeholder="Plantas, Insumos…" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
        </div>
        <div><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Giro</label><input value="{{ supFGiro }}" onInput="{{ onSupGiro }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
        <div style="display:flex;gap:10px;">
          <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Contacto</label><input value="{{ supFContact }}" onInput="{{ onSupContact }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
          <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Teléfono</label><input value="{{ supFPhone }}" onInput="{{ onSupPhone }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
        </div>
        <div style="display:flex;gap:10px;">
          <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Email</label><input value="{{ supFEmail }}" onInput="{{ onSupEmail }}" type="email" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
          <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Sitio web</label><input value="{{ supFWebsite }}" onInput="{{ onSupWebsite }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
        </div>
        <div><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Dirección</label><input value="{{ supFAddress }}" onInput="{{ onSupAddress }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
        <div style="display:flex;gap:10px;">
          <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Condiciones de pago</label><select value="{{ supFPayTerms }}" onChange="{{ onSupPayTerms }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 12px;font-family:inherit;font-size:14px;font-weight:700;color:#0F2A1B;outline:none;background:#F8FAFC;cursor:pointer;box-sizing:border-box;"><option value="contado">Contado</option><option value="30">30 días</option><option value="60">60 días</option><option value="90">90 días</option></select></div>
          <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Banco</label><input value="{{ supFBank }}" onInput="{{ onSupBank }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
        </div>
        <div><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Cuenta</label><input value="{{ supFAccount }}" onInput="{{ onSupAccount }}" placeholder="Cta Cte 12345678" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
        <div><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Notas</label><textarea value="{{ supFNotes }}" onInput="{{ onSupNotes }}" rows="2" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;resize:vertical;"></textarea></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:20px;">
        <button onClick="{{ closeSupForm }}" style="flex:none;border:1px solid #E1E5EE;background:#fff;color:#2A3A2E;border-radius:12px;padding:13px 20px;font-weight:700;font-size:15px;font-family:inherit;cursor:pointer;">Cancelar</button>
        <button onClick="{{ saveSupplier }}" style="{{ saveSupStyle }}">Guardar proveedor</button>
      </div>
    </div>
  </div>
  </sc-if>
```

- [ ] **Step 2b: Asegurar el overlay para cerrar con clic afuera (opcional, sólo si el patrón existente lo hace)**

Revisar cómo el modal de cliente maneja el overlay; si ese patrón registra el modal en la variable `overlay` (~2707), agregar `S.supForm` a esa expresión para consistencia de bloqueo de scroll. Si no, omitir.

- [ ] **Step 3: Verificación manual**

Run: `pnpm tauri dev`
- Admin → Proveedores → "+ Nuevo proveedor": el botón "Guardar" está deshabilitado hasta escribir razón social; al guardar aparece en la lista.
- "Editar" en una fila: precarga los datos; al guardar se actualizan.
Expected: crear y editar funcionan; RUT se normaliza al formato `12.345.678-9`.

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat(proveedores): modal de ficha completa (crear/editar)"
```

---

### Task A5: Asociación opcional proveedor ↔ producto

**Files:**
- Modify: `src/index.html` (`openAddProduct` ~2711, `openEditProduct` ~2744, `saveProduct` ~2765, form de producto ~1690–1702, bindings, ficha de proveedor)

**Interfaces:**
- Consumes: `state.suppliers`, `state.prodForm`, `saveProduct`.
- Produces: campo `supplierId` opcional en cada `product` y en `prodForm`; binding `formSupplierOpts`, `formSupplierId`, `onFormSupplier`; en la ficha del proveedor, `supForm` muestra productos asociados (solo lectura, al editar).

- [ ] **Step 1: Incluir `supplierId` en el form de producto**

En `openAddProduct` (~2711) agregar `supplierId: ''` al objeto `prodForm`.
En `openEditProduct` (~2744) agregar `supplierId: p.supplierId || ''`.
En `saveProduct` (~2765), en ambos returns (crear/editar), incluir `supplierId: f.supplierId || null` en el objeto producto.

- [ ] **Step 2: Bindings del selector de proveedor**

En el objeto de bindings agregar:

```js
      formSupplierId: S.prodForm ? (S.prodForm.supplierId || '') : '',
      onFormSupplier: (e) => this.onFormField('supplierId', e.target.value),
      formSupplierOpts: [{ value: '', label: 'Sin proveedor' }].concat(
        S.suppliers.filter(x => x.active).map(x => ({ value: x.id, label: x.razonSocial }))
      ),
```

- [ ] **Step 3: Agregar el selector en el form de producto**

En el modal de producto (antes del botón guardar ~1702) agregar:

```html
        <div><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Proveedor (opcional)</label>
          <select value="{{ formSupplierId }}" onChange="{{ onFormSupplier }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 12px;font-family:inherit;font-size:14px;font-weight:700;color:#0F2A1B;outline:none;background:#F8FAFC;cursor:pointer;box-sizing:border-box;">
            <sc-for list="{{ formSupplierOpts }}" as="o" hint-placeholder-count="3"><option value="{{ o.value }}">{{ o.label }}</option></sc-for>
          </select>
        </div>
```

- [ ] **Step 4: Mostrar productos asociados en la ficha del proveedor (al editar)**

En los bindings del form de proveedor agregar:

```js
      supFProducts: (S.supForm && S.supForm.id)
        ? S.products.filter(p => p.supplierId === S.supForm.id).map(p => ({ id: p.id, name: p.name }))
        : [],
      supFProductsShow: !!(S.supForm && S.supForm.id && S.products.some(p => p.supplierId === S.supForm.id)),
```

En el modal de proveedor, antes de los botones, agregar:

```html
        <sc-if value="{{ supFProductsShow }}" hint-placeholder-val="{{ false }}">
        <div><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Productos asociados</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <sc-for list="{{ supFProducts }}" as="p" hint-placeholder-count="2"><span style="font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:#EEF1F6;color:#0F2A1B;">{{ p.name }}</span></sc-for>
          </div>
        </div>
        </sc-if>
```

- [ ] **Step 5: Verificación manual**

Run: `pnpm tauri dev`
- Stock → editar un producto → asignar un proveedor activo → guardar.
- Admin → Proveedores → editar ese proveedor: aparece el producto en "Productos asociados".
Expected: la asociación persiste en memoria y se ve en ambas fichas.

- [ ] **Step 6: Commit**

```bash
git add src/index.html
git commit -m "feat(proveedores): asociación opcional proveedor-producto"
```

---

# FASE B — Cotizaciones (cajero + admin, dentro de Venta)

### Task B1: Estado y helpers de fechas de cotización

**Files:**
- Modify: `src/index.html` (`this.state`, helpers junto a `fmt` ~2273)

**Interfaces:**
- Produces: `state.quotes: Array<{id, folio, dateIso, validUntilIso, customerId, lines:[{name,qty,price}], total, neto, iva, converted, saleFolio}>`; `state.quoteSeq:number`; `state.quoteView: 'grid'|'list'|'cotizaciones'` (subvista); `state.quoteToPrint: quote|null` (para la vista A4). Helpers `isoPlusDays(iso, n)`, `isoToday()`, `fmtIsoDate(iso)`.

- [ ] **Step 1: Estado**

En `this.state` agregar:

```js
      quotes: [],
      quoteSeq: 1001,
      quoteView: 'venta',   // 'venta' | 'cotizaciones'
      quoteToPrint: null,   // cotización en vista A4 para PDF
      quoteDaysDefault: 7,
```

- [ ] **Step 2: Helpers de fecha**

Junto a `fmt` (~2273) agregar:

```js
  isoToday = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  isoPlusDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); const p = (x) => String(x).padStart(2, '0'); return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`; };
  fmtIsoDate = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  isQuoteVigente = (iso) => iso >= this.isoToday();
```

- [ ] **Step 3: Verificar**

Run: `pnpm tauri dev` — sin errores en consola.

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit -m "feat(cotizaciones): estado y helpers de fecha/vigencia"
```

---

### Task B2: Crear cotización desde el carrito

**Files:**
- Modify: `src/index.html` (handlers junto a `confirmPay` ~2613, bindings, botón en Venta ~572)

**Interfaces:**
- Consumes: `state.cart`, `this.totals()`, `this.find()`, `state.customerId`, helpers B1.
- Produces: `createQuote()`, binding `createQuote`, `cotizarStyle`, `cotizarDisabled`.

- [ ] **Step 1: Handler `createQuote`**

Junto a `confirmPay` (~2613) agregar:

```js
  createQuote = () => {
    const s = this.state;
    if (!s.cart.length) return;
    const lines = s.cart.map(c => { const p = this.find(c.id); return { name: p.name, qty: c.qty, price: p.price }; });
    const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
    const neto = Math.round(total / 1.19);
    const dateIso = this.isoToday();
    const quote = {
      id: 'qt' + Date.now(),
      folio: s.quoteSeq,
      dateIso,
      validUntilIso: this.isoPlusDays(dateIso, s.quoteDaysDefault),
      customerId: s.customerId || null,
      lines, total, neto, iva: total - neto,
      converted: false, saleFolio: null,
    };
    this.setState({ quotes: [quote, ...s.quotes], quoteSeq: s.quoteSeq + 1, cart: [], quoteView: 'cotizaciones' });
  };
```

- [ ] **Step 2: Bindings**

```js
      createQuote: this.createQuote,
      cotizarStyle: { border: '1px solid var(--accent)', borderRadius: 13, padding: '14px 22px', fontWeight: 700, fontSize: 15, fontFamily: 'inherit', cursor: S.cart.length ? 'pointer' : 'not-allowed', color: S.cart.length ? '#0a6e36' : '#9aa8bd', background: '#fff' },
```

- [ ] **Step 3: Botón "Cotizar" en la barra de acciones de Venta**

Junto al botón "Cobrar" (~572) agregar antes de él:

```html
            <button onClick="{{ createQuote }}" style="{{ cotizarStyle }}">Cotizar</button>
```

- [ ] **Step 4: Verificación manual**

Run: `pnpm tauri dev`
- Venta → agregar productos al carrito → "Cotizar".
Expected: el carrito se vacía y la subvista cambia a "Cotizaciones" (aún sin lista visible hasta B3). Verificar en React DevTools/consola `this.state.quotes` que se creó una con folio 1001 y `validUntilIso` = hoy+7.

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat(cotizaciones): crear cotización desde el carrito"
```

---

### Task B3: Subvista "Cotizaciones" dentro de Venta (listado)

**Files:**
- Modify: `src/index.html` (plantilla de Venta ~480–580, bindings, toggle de subvista)

**Interfaces:**
- Consumes: `state.quotes`, `state.quoteView`, helpers de vigencia.
- Produces: bindings `quoteTabVenta`/`quoteTabCotiz` (toggle), `setQuoteViewVenta`/`setQuoteViewCotiz`, `isQuoteView`, `quoteRows`.

- [ ] **Step 1: Handlers de toggle**

```js
  setQuoteView = (v) => this.setState({ quoteView: v });
```

- [ ] **Step 2: Bindings**

```js
      isQuoteView: S.quoteView === 'cotizaciones',
      setQuoteViewVenta: () => this.setQuoteView('venta'),
      setQuoteViewCotiz: () => this.setQuoteView('cotizaciones'),
      quoteTabVentaStyle: { border: 0, background: S.quoteView === 'venta' ? 'var(--accent)' : 'transparent', color: S.quoteView === 'venta' ? '#fff' : '#5a6b7e', borderRadius: 999, padding: '7px 16px', fontWeight: 700, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer' },
      quoteTabCotizStyle: { border: 0, background: S.quoteView === 'cotizaciones' ? 'var(--accent)' : 'transparent', color: S.quoteView === 'cotizaciones' ? '#fff' : '#5a6b7e', borderRadius: 999, padding: '7px 16px', fontWeight: 700, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer' },
      quoteRows: S.quotes.map(q => {
        const cust = S.customers.find(c => c.id === q.customerId);
        const vigente = this.isQuoteVigente(q.validUntilIso);
        return {
          id: q.id,
          folioStr: 'COT-' + q.folio,
          dateStr: this.fmtIsoDate(q.dateIso),
          validStr: 'Vence ' + this.fmtIsoDate(q.validUntilIso),
          custStr: cust ? cust.name : 'Sin cliente',
          totalStr: this.fmt(q.total),
          itemsStr: q.lines.reduce((a, l) => a + l.qty, 0) + ' ítems',
          badgeLabel: q.converted ? 'Convertida' : (vigente ? 'Vigente' : 'Vencida'),
          badgeStyle: { fontSize: '11.5px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', whiteSpace: 'nowrap', background: q.converted ? '#EAF0FF' : (vigente ? '#E6F7EE' : '#FCECEC'), color: q.converted ? '#1d4ed8' : (vigente ? '#0a6e36' : '#c0392b') },
          converted: q.converted,
          onPrint: () => this.printQuote(q),
          onPdf: () => this.openQuotePdf(q),
          onConvert: () => this.convertQuote(q.id),
        };
      }),
```

> `printQuote`, `openQuotePdf`, `convertQuote` se implementan en B4/B5/B6. Este binding los referencia; si se implementa B3 primero, definir stubs `printQuote = () => {}`, `openQuotePdf = () => {}`, `convertQuote = () => {}` temporalmente y reemplazarlos en las tareas siguientes. (Preferible implementar B4–B6 antes de exponer los botones.)

- [ ] **Step 3: Toggle + lista en la plantilla de Venta**

En la cabecera de la pantalla Venta, agregar el toggle (Venta / Cotizaciones) y, cuando `isQuoteView`, renderizar la lista en lugar de la grilla de productos. Estructura:

```html
      <div style="display:inline-flex;gap:4px;background:#F0F2F7;border-radius:999px;padding:4px;margin-bottom:16px;">
        <button onClick="{{ setQuoteViewVenta }}" style="{{ quoteTabVentaStyle }}">Venta</button>
        <button onClick="{{ setQuoteViewCotiz }}" style="{{ quoteTabCotizStyle }}">Cotizaciones</button>
      </div>
      <sc-if value="{{ isQuoteView }}" hint-placeholder-val="{{ false }}">
      <div style="display:flex;flex-direction:column;gap:10px;">
        <sc-for list="{{ quoteRows }}" as="q" hint-placeholder-count="3">
          <div style="display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #E1E5EE;border-radius:14px;padding:16px 18px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:14.5px;font-weight:800;color:#0F2A1B;">{{ q.folioStr }} · {{ q.custStr }}</div>
              <div style="font-size:12.5px;color:#7C95A8;margin-top:2px;">{{ q.dateStr }} · {{ q.validStr }} · {{ q.itemsStr }}</div>
            </div>
            <span style="{{ q.badgeStyle }}">{{ q.badgeLabel }}</span>
            <div style="font-size:16px;font-weight:900;color:#0F2A1B;">{{ q.totalStr }}</div>
            <button onClick="{{ q.onPrint }}" style="border:1px solid #E1E5EE;background:#fff;color:#5a6b7e;border-radius:10px;padding:8px 12px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;">Imprimir</button>
            <button onClick="{{ q.onPdf }}" style="border:1px solid #E1E5EE;background:#fff;color:#5a6b7e;border-radius:10px;padding:8px 12px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;">PDF</button>
            <button onClick="{{ q.onConvert }}" style="border:1px solid var(--accent);background:#fff;color:#0a6e36;border-radius:10px;padding:8px 14px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;">Convertir</button>
          </div>
        </sc-for>
        <sc-if value="{{ quotesEmpty }}" hint-placeholder-val="{{ false }}"><div style="padding:34px 22px;text-align:center;font-size:13.5px;color:#9aa8bd;">Aún no hay cotizaciones.</div></sc-if>
      </div>
      </sc-if>
      <sc-if value="{{ isVentaGrid }}" hint-placeholder-val="{{ true }}">
      <!-- (aquí queda el contenido existente de la grilla/lista de productos de Venta) -->
      </sc-if>
```

Agregar bindings auxiliares: `quotesEmpty: S.quotes.length === 0`, y `isVentaGrid: S.quoteView !== 'cotizaciones'` (envolver la grilla de productos existente en ese `sc-if`).

- [ ] **Step 4: Verificación manual**

Run: `pnpm tauri dev`
- Crear una cotización (B2) y luego alternar Venta/Cotizaciones.
Expected: la lista muestra la cotización con badge "Vigente", folio COT-1001 y total correcto. (Los botones Imprimir/PDF/Convertir se prueban en B4–B6.)

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat(cotizaciones): subvista de listado dentro de Venta"
```

---

### Task B4: Comando Rust `print_quote` (TDD)

**Files:**
- Modify: `src-tauri/src/escpos.rs` (struct + `build_quote` + tests), `src-tauri/src/lib.rs` (comando + registro)

**Interfaces:**
- Produces: `QuotePayload { negocio: Negocio, folio: u32, fecha: String, valido_hasta: String, cliente: String, items: Vec<Item>, neto: i64, iva: i64, total: i64 }`; `pub fn build_quote(&QuotePayload) -> Vec<u8>`; comando `print_quote(payload: QuotePayload) -> Result<(), String>`.

- [ ] **Step 1: Escribir el test (falla)**

En `src-tauri/src/escpos.rs`, dentro de `mod tests`, agregar:

```rust
    fn sample_quote() -> QuotePayload {
        let s = sample("efectivo", true);
        QuotePayload {
            negocio: s.negocio,
            folio: 1001,
            fecha: "06/07/2026".into(),
            valido_hasta: "13/07/2026".into(),
            cliente: "Juan Pérez".into(),
            items: vec![Item { nombre: "Monstera".into(), qty: 2, precio: 14990 }],
            neto: 25193, iva: 4787, total: 29980,
        }
    }

    #[test]
    fn quote_init_corte_sin_gaveta_sin_timbre() {
        let b = build_quote(&sample_quote());
        assert_eq!(&b[0..2], &[0x1B, 0x40]);
        assert!(contains(&b, &[0x1D, 0x56, 0x42, 0x00]));                 // corte
        assert!(!contains(&b, &[0x1B, 0x70, 0x00, 0x19, 0xFA]));         // sin gaveta
        assert!(!contains(&b, &[0x1D, 0x28, 0x6B]));                     // sin QR/timbre
    }

    #[test]
    fn quote_incluye_textos() {
        let b = build_quote(&sample_quote());
        assert!(contains(&b, b"COTIZACION"));
        assert!(contains(&b, b"No 1001"));
        assert!(contains(&b, b"Valido hasta: 13/07/2026"));
        assert!(contains(&b, b"Monstera"));
        assert!(contains(&b, b"TOTAL"));
    }
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd C:/Kromi/kromi-pos/src-tauri && cargo test build_quote quote_ 2>&1 | tail -20`
Expected: FALLA de compilación (`QuotePayload`/`build_quote` no existen).

- [ ] **Step 3: Implementar struct + `build_quote`**

En `escpos.rs`, tras `ReceiptPayload` (~33), agregar el struct:

```rust
#[derive(Deserialize, Clone)]
pub struct QuotePayload {
    pub negocio: Negocio,
    pub folio: u32,
    pub fecha: String,
    pub valido_hasta: String,
    pub cliente: String,
    pub items: Vec<Item>,
    pub neto: i64,
    pub iva: i64,
    pub total: i64,
}
```

Y tras `build_cierre` agregar (documento NO tributario: sin timbre, sin gaveta):

```rust
pub fn build_quote(p: &QuotePayload) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(&[0x1B, 0x40]); // init
    b.extend_from_slice(include_bytes!("../assets/logo.escpos"));
    nl(&mut b);

    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    push_text(&mut b, &format!("* {} *", p.negocio.tagline)); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    nl(&mut b);
    line_center(&mut b, &p.negocio.razon_social);
    line_center(&mut b, &p.negocio.giro);
    nl(&mut b);

    box_ascii(&mut b, &[
        &format!("R.U.T.: {}", p.negocio.rut),
        "COTIZACION",
        &format!("No {}", p.folio),
    ], 32);
    nl(&mut b);

    push_text(&mut b, &format!("Fecha: {}", p.fecha)); nl(&mut b);
    push_text(&mut b, &format!("Valido hasta: {}", p.valido_hasta)); nl(&mut b);
    push_text(&mut b, &format!("Cliente: {}", p.cliente)); nl(&mut b);
    rule(&mut b, b'-');

    b.extend_from_slice(&[0x1B, 0x45, 0x01]);
    line_lr(&mut b, "Item", "Subtotal", COL);
    b.extend_from_slice(&[0x1B, 0x45, 0x00]);
    rule(&mut b, b'=');
    for it in &p.items {
        line_lr(&mut b, &it.nombre, &money(it.precio * it.qty as i64), COL);
        push_text(&mut b, &format!("   {} x {}", it.qty, money(it.precio))); nl(&mut b);
    }
    rule(&mut b, b'=');

    line_lr(&mut b, "Neto", &money(p.neto), COL);
    line_lr(&mut b, "IVA 19%", &money(p.iva), COL);
    nl(&mut b);
    b.extend_from_slice(&[0x1D, 0x21, 0x11]);
    line_lr(&mut b, "TOTAL", &money(p.total), 24);
    b.extend_from_slice(&[0x1D, 0x21, 0x00]);
    nl(&mut b);
    rule(&mut b, b'-');
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    push_text(&mut b, "Documento no tributario"); nl(&mut b);
    push_text(&mut b, &p.negocio.footer); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);

    b.extend_from_slice(&[0x0A, 0x0A, 0x0A, 0x0A]);
    b.extend_from_slice(&[0x1D, 0x56, 0x42, 0x00]); // corte, sin gaveta
    b
}
```

- [ ] **Step 4: Agregar el comando y registrarlo**

En `lib.rs`: importar `QuotePayload` (`use escpos::{CierrePayload, QuotePayload, ReceiptPayload};`), agregar el comando:

```rust
#[tauri::command]
fn print_quote(payload: QuotePayload) -> Result<(), String> {
    let bytes = escpos::build_quote(&payload);
    let printer = payload.negocio.printer_name.clone();
    match printing::send_raw(&printer, &bytes) {
        Ok(()) => Ok(()),
        Err(_) => printing::send_raw(&printer, &bytes),
    }
}
```

Y registrarlo: `.invoke_handler(tauri::generate_handler![greet, print_receipt, print_cierre, print_quote])`.

- [ ] **Step 5: Correr tests (pasan)**

Run: `cd C:/Kromi/kromi-pos/src-tauri && cargo test 2>&1 | tail -20`
Expected: PASA todo, incluidos `quote_init_corte_sin_gaveta_sin_timbre` y `quote_incluye_textos`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/escpos.rs src-tauri/src/lib.rs
git commit -m "feat(cotizaciones): comando ESC/POS print_quote con tests"
```

---

### Task B5: Imprimir cotización desde el frontend

**Files:**
- Modify: `src/index.html` (handler `printQuote`, reusar `buildCierrePayload`/`cfgRecibo` como en `printCierre` ~2516)

**Interfaces:**
- Consumes: `state.cfgRecibo`, `state.customers`, `window.__TAURI__`.
- Produces: `printQuote(quote)`, `buildQuotePayload(quote)`.

- [ ] **Step 1: Implementar `buildQuotePayload` y `printQuote`**

Junto a `printCierre` (~2516) agregar:

```js
  buildQuotePayload = (q) => {
    const cr = this.state.cfgRecibo;
    const cust = this.state.customers.find(c => c.id === q.customerId);
    return {
      negocio: {
        tagline: cr.tagline, razon_social: cr.razonSocial, rut: cr.rut,
        giro: cr.giro, direccion: cr.direccion, footer: cr.footer,
        printer_name: cr.printerName, social: null,
      },
      folio: q.folio,
      fecha: this.fmtIsoDate(q.dateIso),
      valido_hasta: this.fmtIsoDate(q.validUntilIso),
      cliente: cust ? cust.name : 'Sin cliente',
      items: q.lines.map(l => ({ nombre: l.name, qty: l.qty, precio: l.price })),
      neto: q.neto, iva: q.iva, total: q.total,
    };
  };
  printQuote = (q) => {
    if (!q) return;
    const tauri = window.__TAURI__;
    if (tauri && tauri.core && typeof tauri.core.invoke === 'function') {
      this.flashPrintToast({ ok: null, label: 'Imprimiendo cotización…', retry: null });
      tauri.core.invoke('print_quote', { payload: this.buildQuotePayload(q) })
        .then(() => this.flashPrintToast({ ok: true, label: 'Cotización impresa.', retry: null }))
        .catch(err => { console.error('print_quote:', err); this.flashPrintToast({ ok: false, label: 'No se pudo imprimir la cotización.', retry: () => this.printQuote(q) }); });
    } else {
      try { window.print(); } catch (e) {}
    }
  };
```

Si en B3 se dejó un stub `printQuote`, eliminarlo.

- [ ] **Step 2: Verificación manual**

Run: `pnpm tauri dev` (con impresora térmica o al menos comprobar que no lanza error si no hay).
- Cotizaciones → "Imprimir" en una fila.
Expected: aparece el toast "Imprimiendo cotización…" y luego éxito/fallo. Con impresora conectada, imprime el documento "COTIZACION" con folio y "Valido hasta".

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "feat(cotizaciones): imprimir cotización térmica desde el frontend"
```

---

### Task B6: Exportar a PDF (vista A4 + window.print) y convertir a venta

**Files:**
- Modify: `src/index.html` (handlers `openQuotePdf`/`closeQuotePdf`/`convertQuote`, bloque de vista A4, bindings)

**Interfaces:**
- Consumes: `state.quotes`, `state.cart`, `state.products`, `state.quoteToPrint`.
- Produces: `openQuotePdf(q)`, `closeQuotePdf()`, `convertQuote(id)`; bindings `quotePdfOpen`, `quotePdf` (objeto con líneas y totales formateados), `doPrintPdf`.

- [ ] **Step 1: Handlers**

```js
  openQuotePdf = (q) => this.setState({ quoteToPrint: q });
  closeQuotePdf = () => this.setState({ quoteToPrint: null });
  doPrintPdf = () => { try { window.print(); } catch (e) {} };
  convertQuote = (id) => {
    const s = this.state;
    const q = s.quotes.find(x => x.id === id);
    if (!q) return;
    // reconstruir carrito por nombre de producto (match con products)
    const cart = [];
    q.lines.forEach(l => {
      const p = s.products.find(pr => pr.name === l.name);
      if (p) cart.push({ id: p.id, qty: l.qty });
    });
    this.setState({ cart, customerId: q.customerId || null, quoteView: 'venta', screen: 'venta' });
  };
```

> La marca `converted`/`saleFolio` se aplica al cobrar: en `confirmPay` (~2613), si venías desde una cotización, marcarla. Implementación mínima: al convertir, guardar `state.convertingQuoteId = id`; en `confirmPay`, tras crear la venta, si `convertingQuoteId`, setear en esa quote `converted:true, saleFolio: folio` y limpiar `convertingQuoteId`. Agregar `convertingQuoteId: null` al estado y la lógica en `confirmPay`.

Detalle a agregar en estado: `convertingQuoteId: null`. En `convertQuote`, incluir `convertingQuoteId: id` en el `setState`. En `confirmPay`, dentro del `setState` que crea la venta, añadir:

```js
      quotes: s.convertingQuoteId
        ? s.quotes.map(q => q.id === s.convertingQuoteId ? { ...q, converted: true, saleFolio: folio } : q)
        : s.quotes,
      convertingQuoteId: null,
```
(usar el mismo `folio` que se asigna a la venta en ese método).

- [ ] **Step 2: Bindings de la vista A4**

```js
      quotePdfOpen: !!S.quoteToPrint,
      closeQuotePdf: this.closeQuotePdf,
      doPrintPdf: this.doPrintPdf,
      quotePdf: S.quoteToPrint ? (() => {
        const q = S.quoteToPrint;
        const cust = S.customers.find(c => c.id === q.customerId);
        const cr = S.cfgRecibo;
        return {
          negocio: cr.razonSocial, giro: cr.giro, rut: cr.rut, direccion: cr.direccion,
          folioStr: 'COT-' + q.folio,
          fecha: this.fmtIsoDate(q.dateIso),
          validez: this.fmtIsoDate(q.validUntilIso),
          cliente: cust ? cust.name : 'Sin cliente',
          lines: q.lines.map(l => ({ name: l.name, qty: l.qty, price: this.fmt(l.price), subtotal: this.fmt(l.qty * l.price) })),
          neto: this.fmt(q.neto), iva: this.fmt(q.iva), total: this.fmt(q.total),
        };
      })() : null,
```

- [ ] **Step 3: Vista A4 imprimible + CSS de impresión**

Agregar, al final del árbol de la app (antes de cerrar el componente raíz), un contenedor `id="quote-print-area"` que sólo se muestra cuando `quotePdfOpen`. Agregar al `<style>` del `<head>` reglas `@media print` que oculten todo salvo `#quote-print-area`:

```html
<style>
@media print {
  body * { visibility: hidden !important; }
  #quote-print-area, #quote-print-area * { visibility: visible !important; }
  #quote-print-area { position: absolute; left: 0; top: 0; width: 100%; }
}
</style>
```

Bloque de plantilla (overlay en pantalla con botones + el área A4):

```html
  <sc-if value="{{ quotePdfOpen }}" hint-placeholder-val="{{ false }}">
  <div style="position:absolute;inset:0;background:rgba(15,42,27,.4);display:flex;flex-direction:column;align-items:center;overflow:auto;z-index:70;padding:24px;">
    <div style="display:flex;gap:10px;margin-bottom:14px;" class="no-print">
      <button onClick="{{ doPrintPdf }}" style="border:0;background:var(--accent);color:#fff;border-radius:11px;padding:11px 20px;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer;">Guardar como PDF / Imprimir</button>
      <button onClick="{{ closeQuotePdf }}" style="border:1px solid #fff;background:transparent;color:#fff;border-radius:11px;padding:11px 20px;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer;">Cerrar</button>
    </div>
    <div id="quote-print-area" style="width:794px;max-width:100%;background:#fff;border-radius:6px;padding:48px 56px;color:#111;font-size:13px;box-sizing:border-box;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:20px;">
        <div><div style="font-size:22px;font-weight:900;">{{ quotePdf.negocio }}</div><div style="color:#555;">{{ quotePdf.giro }}</div><div style="color:#555;">RUT: {{ quotePdf.rut }}</div><div style="color:#555;">{{ quotePdf.direccion }}</div></div>
        <div style="text-align:right;"><div style="font-size:18px;font-weight:900;">COTIZACIÓN</div><div style="font-weight:700;">{{ quotePdf.folioStr }}</div><div style="color:#555;">Fecha: {{ quotePdf.fecha }}</div><div style="color:#555;">Válida hasta: {{ quotePdf.validez }}</div></div>
      </div>
      <div style="margin-bottom:16px;"><strong>Cliente:</strong> {{ quotePdf.cliente }}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:1px solid #111;text-align:left;"><th style="padding:8px 0;">Ítem</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">Precio</th><th style="text-align:right;">Subtotal</th></tr></thead>
        <tbody>
          <sc-for list="{{ quotePdf.lines }}" as="l" hint-placeholder-count="3"><tr style="border-bottom:1px solid #eee;"><td style="padding:7px 0;">{{ l.name }}</td><td style="text-align:center;">{{ l.qty }}</td><td style="text-align:right;">{{ l.price }}</td><td style="text-align:right;">{{ l.subtotal }}</td></tr></sc-for>
        </tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:18px;"><table style="font-size:13px;"><tr><td style="padding:3px 24px 3px 0;color:#555;">Neto</td><td style="text-align:right;">{{ quotePdf.neto }}</td></tr><tr><td style="padding:3px 24px 3px 0;color:#555;">IVA 19%</td><td style="text-align:right;">{{ quotePdf.iva }}</td></tr><tr style="font-weight:900;font-size:15px;"><td style="padding:6px 24px 3px 0;border-top:1px solid #111;">TOTAL</td><td style="text-align:right;border-top:1px solid #111;">{{ quotePdf.total }}</td></tr></table></div>
      <div style="margin-top:36px;color:#888;font-size:11px;">Documento no tributario. Valores sujetos a disponibilidad de stock.</div>
    </div>
  </div>
  </sc-if>
```

> Si el patrón de estilos existente ya define `.no-print`, reutilizarlo; si no, las reglas `@media print` de arriba bastan (ocultan todo salvo `#quote-print-area`).

- [ ] **Step 4: Verificación manual**

Run: `pnpm tauri dev`
- Cotizaciones → "PDF": se abre la vista A4; "Guardar como PDF / Imprimir" abre el diálogo del sistema con sólo la hoja A4 visible.
- Cotizaciones → "Convertir": vuelve a Venta con el carrito cargado; al cobrar, la cotización queda "Convertida" con su folio de venta.
Expected: PDF muestra sólo el documento; conversión carga el carrito y marca la cotización tras el cobro.

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat(cotizaciones): exportar PDF (A4) y convertir a venta"
```

---

# FASE C — Notas de crédito (solo admin)

La más integrada: toca stock, cierre (efectivo esperado + comprobante) e historial.

### Task C1: Estado y semilla de notas de crédito

**Files:**
- Modify: `src/index.html` (`this.state`)

**Interfaces:**
- Produces: `state.creditNotes: Array<{id, folio, dateIso, time, cajaSessionId, cashierId, saleFolio, method:'efectivo'|'tarjeta', reason, lines:[{name,qty,price,restock}], total, neto, iva}>`; `state.ncSeq:number`; `state.ncForm: null | form`.

- [ ] **Step 1: Estado**

En `this.state`:

```js
      creditNotes: [],
      ncSeq: 501,
      ncForm: null,
```

- [ ] **Step 2: Verificar**

Run: `pnpm tauri dev` — sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "feat(notas-credito): estado inicial"
```

---

### Task C2: Handlers de nota de crédito (crear desde boleta / manual, stock, folio)

**Files:**
- Modify: `src/index.html` (handlers junto a `doCierre` ~2465)

**Interfaces:**
- Consumes: `state.sales`, `state.products`, `state.cajaOpen`, `state.cajaSessionId`, `state.session`, helpers de fecha (B1).
- Produces: `openNcFromSale(folio)`, `openNcManual()`, `closeNcForm()`, `onNcField(field,value)`, `toggleNcLineRestock(idx)`, `onNcLineQty(idx,val)`, `saveCreditNote()`.

- [ ] **Step 1: Handlers**

Junto a `doCierre` (~2465) agregar:

```js
  openNcManual = () => {
    if (!this.state.cajaOpen) { this.flashPrintToast({ ok: false, label: 'Abre la caja para registrar una nota de crédito.', retry: null }); return; }
    this.setState({ ncForm: { id: null, saleFolio: null, method: 'efectivo', reason: '', lines: [{ name: '', qty: 1, price: 0, restock: true }] } });
  };
  openNcFromSale = (folio) => {
    if (!this.state.cajaOpen) { this.flashPrintToast({ ok: false, label: 'Abre la caja para registrar una nota de crédito.', retry: null }); return; }
    const sale = this.state.sales.find(x => x.folio === folio);
    if (!sale) return;
    this.setState({ ncForm: {
      id: null, saleFolio: sale.folio, method: sale.method, reason: '',
      lines: sale.lines.map(l => ({ name: l.name, qty: l.qty, price: l.price, restock: true })),
    } });
  };
  closeNcForm = () => this.setState({ ncForm: null });
  onNcField = (field, value) => this.setState(s => ({ ncForm: { ...s.ncForm, [field]: value } }));
  onNcLineQty = (idx, value) => this.setState(s => {
    const qty = Math.max(0, parseInt((value || '0').replace(/[^\d]/g, ''), 10) || 0);
    const lines = s.ncForm.lines.map((l, i) => i === idx ? { ...l, qty } : l);
    return { ncForm: { ...s.ncForm, lines } };
  });
  toggleNcLineRestock = (idx) => this.setState(s => ({ ncForm: { ...s.ncForm, lines: s.ncForm.lines.map((l, i) => i === idx ? { ...l, restock: !l.restock } : l) } }));
  saveCreditNote = () => {
    const s = this.state;
    const f = s.ncForm;
    if (!f || !s.cajaOpen) return;
    const lines = f.lines.filter(l => l.name && l.qty > 0);
    if (!lines.length) return;
    const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
    if (total <= 0) return;
    const neto = Math.round(total / 1.19);
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const nc = {
      id: 'nc' + Date.now(),
      folio: s.ncSeq,
      dateIso: this.isoToday(),
      time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
      cajaSessionId: s.cajaSessionId,
      cashierId: s.session ? s.session.id : null,
      saleFolio: f.saleFolio,
      method: f.method,
      reason: (f.reason || '').trim(),
      lines: lines.map(l => ({ name: l.name, qty: l.qty, price: l.price, restock: !!l.restock })),
      total, neto, iva: total - neto,
    };
    // reponer stock por línea con restock (match por nombre)
    const products = s.products.map(p => {
      const back = lines.filter(l => l.restock && l.name === p.name).reduce((a, l) => a + l.qty, 0);
      return back ? { ...p, stock: p.stock + back } : p;
    });
    this.setState({ creditNotes: [nc, ...s.creditNotes], ncSeq: s.ncSeq + 1, ncForm: null, products, lastNc: nc },
      () => this.printCreditNote(nc));
  };
```

> `printCreditNote` se define en C5. Si se implementa C2 antes, dejar `printCreditNote = () => {}` temporal.
> Agregar `lastNc: null` al estado (para reimpresión).

- [ ] **Step 2: Verificar**

Run: `pnpm tauri dev` — sin errores de sintaxis. (La UI se agrega en C3/C4.)

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "feat(notas-credito): handlers de creación, stock y folio"
```

---

### Task C3: Integración con el Cierre de caja (resta efectivo, línea aparte, no pérdida)

**Files:**
- Modify: `src/index.html` (`doCierre` ~2465, `buildCierrePayload` ~2492, bindings del cierre ~3338+, plantilla del cierre ~1188–1210)

**Interfaces:**
- Consumes: `state.creditNotes`, `state.cajaSessionId`.
- Produces: en el snapshot `rec` del cierre: `ncCash`, `ncCard`; ajuste de `counted`/esperado; bindings `cierreNcCashStr`, `cierreNcCardStr`, `cierreNcShow`; payload Rust con `nc_cash`/`nc_card`.

- [ ] **Step 1: Calcular NC del turno en `doCierre`**

En `doCierre` (~2465), tras calcular `cash`/`card`, agregar:

```js
    const ncTurno = s.creditNotes.filter(n => n.cajaSessionId === s.cajaSessionId);
    const ncCash = ncTurno.filter(n => n.method === 'efectivo').reduce((a, n) => a + n.total, 0);
    const ncCard = ncTurno.filter(n => n.method === 'tarjeta').reduce((a, n) => a + n.total, 0);
```

En el objeto `rec`, agregar `ncCash, ncCard,` y en `rec.sales`/snapshot añadir `rec.creditNotes = ncTurno.map(n => ({ folio: n.folio, method: n.method, total: n.total, reason: n.reason }));`.

- [ ] **Step 2: Ajustar el binding de esperado/diferencia del cierre**

En los cálculos del cierre en el render (~3338+, donde se computa `cierreExpected`/`cierreExpectedStr`), la fórmula de efectivo esperado pasa de `float + cashSales` a `float + cashSales - ncCashTurno`. Definir en ese bloque:

```js
      const ncTurnoLive = S.creditNotes.filter(n => n.cajaSessionId === S.cajaSessionId);
      const ncCashLive = ncTurnoLive.filter(n => n.method === 'efectivo').reduce((a, n) => a + n.total, 0);
      const ncCardLive = ncTurnoLive.filter(n => n.method === 'tarjeta').reduce((a, n) => a + n.total, 0);
```

Y donde hoy se calcula el esperado, restar `ncCashLive`. Añadir bindings:

```js
      cierreNcShow: (ncCashLive + ncCardLive) > 0,
      cierreNcCashStr: '-' + this.fmt(ncCashLive),
      cierreNcCardStr: '-' + this.fmt(ncCardLive),
```

- [ ] **Step 3: Mostrar las líneas de NC en el desglose del cierre**

En la plantilla del cierre (~1188–1200, en el bloque "Fondo de apertura / Ventas en efectivo / Esperado en caja"), agregar antes de "Esperado en caja":

```html
            <sc-if value="{{ cierreNcShow }}" hint-placeholder-val="{{ false }}">
            <div style="display:flex;justify-content:space-between;font-size:13px;color:#c0392b;margin-bottom:7px;"><span>Notas de crédito (efectivo)</span><span>{{ cierreNcCashStr }}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:12.5px;color:#7C95A8;margin-bottom:7px;"><span>Reversos tarjeta (informativo)</span><span>{{ cierreNcCardStr }}</span></div>
            </sc-if>
```

> Importante: la línea de NC efectivo se resta del **esperado**, no del contado, así que un cuadre correcto NO genera descuadre ni "pérdida"; sólo baja lo que debe haber en caja.

- [ ] **Step 4: Verificación manual**

Run: `pnpm tauri dev`
- Abrir caja, hacer una venta en efectivo, crear una NC en efectivo (vía C4), ir a Cierre.
Expected: aparece "Notas de crédito (efectivo) −$X" y el "Esperado en caja" baja en ese monto; si cuentas el efectivo real (ventas−NC+fondo) el cierre queda CUADRADO (no faltante).

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat(notas-credito): integración con cierre (resta efectivo, no pérdida)"
```

---

### Task C4: UI de creación de NC — desde Historial (boleta) y manual

**Files:**
- Modify: `src/index.html` (detalle de venta en Historial ~928–964, botón NC manual, modal de NC, bindings)

**Interfaces:**
- Consumes: handlers C2, `state.ncForm`.
- Produces: botón "Nota de crédito" en el detalle de una boleta y en la cabecera de Historial (manual); modal `ncFormOpen` con líneas editables (qty + restock por línea), método, motivo.

- [ ] **Step 1: Botones de acceso**

En el detalle de una venta del historial (donde está el botón reimprimir ticket), agregar (solo admin ya que Historial es admin):

```html
        <button onClick="{{ ncFromCurrentSale }}" style="display:inline-flex;align-items:center;gap:8px;border:1px solid #E1E5EE;background:#fff;color:#c0392b;border-radius:11px;padding:9px 14px;font-weight:700;font-size:13.5px;font-family:inherit;cursor:pointer;">Nota de crédito</button>
```

En la cabecera de Historial (junto a los tabs), agregar botón "Nueva NC manual" → `openNcManual`.

Bindings:

```js
      ncFromCurrentSale: () => { const v = S.sales.find(x => x.folio === (S.ticketFolio || (S.ticket && S.ticket.folio))); if (v) this.openNcFromSale(v.folio); },
      openNcManual: this.openNcManual,
```
> Ajustar `ncFromCurrentSale` al identificador real del folio de la venta abierta en el detalle del historial (revisar cómo el detalle sabe qué venta muestra; usar ese id/folio).

- [ ] **Step 2: Bindings del modal de NC**

```js
      ncFormOpen: !!S.ncForm,
      closeNcForm: this.closeNcForm,
      saveCreditNote: this.saveCreditNote,
      ncFormTitle: (S.ncForm && S.ncForm.saleFolio) ? ('Nota de crédito · boleta ' + S.ncForm.saleFolio) : 'Nota de crédito manual',
      ncFormMethod: S.ncForm ? S.ncForm.method : 'efectivo',
      onNcMethod: (e) => this.onNcField('method', e.target.value),
      ncFormReason: S.ncForm ? S.ncForm.reason : '',
      onNcReason: (e) => this.onNcField('reason', e.target.value),
      ncFormTotalStr: S.ncForm ? this.fmt(S.ncForm.lines.filter(l => l.name && l.qty > 0).reduce((a, l) => a + l.qty * l.price, 0)) : '$0',
      ncFormLines: S.ncForm ? S.ncForm.lines.map((l, i) => ({
        idx: i, name: l.name, qtyStr: String(l.qty), priceStr: this.fmt(l.price), subtotalStr: this.fmt(l.qty * l.price),
        restock: l.restock, restockCheck: l.restock ? '✓' : '',
        restockBoxStyle: { width: 22, height: 22, borderRadius: 7, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: '#fff', border: l.restock ? '0' : '1.5px solid #cdd5e3', background: l.restock ? 'var(--accent)' : '#fff', cursor: 'pointer' },
        onQty: (e) => this.onNcLineQty(i, e.target.value),
        onToggleRestock: () => this.toggleNcLineRestock(i),
      })) : [],
      ncSaveDisabled: !(S.ncForm && S.ncForm.lines.some(l => l.name && l.qty > 0)),
      ncSaveStyle: { flex: 1, border: 0, borderRadius: 12, padding: '13px 18px', fontWeight: 700, fontSize: 15, fontFamily: 'inherit', color: '#fff', background: (S.ncForm && S.ncForm.lines.some(l => l.name && l.qty > 0)) ? '#c0392b' : '#e0a9a2', cursor: (S.ncForm && S.ncForm.lines.some(l => l.name && l.qty > 0)) ? 'pointer' : 'not-allowed' },
```

- [ ] **Step 3: Modal de NC**

Agregar modal (imitar overlay del modal de proveedor). Para NC manual, las líneas parten con un ítem vacío; el usuario escribe nombre/precio/qty. Para NC desde boleta, las líneas vienen precargadas y editables en qty y restock.

```html
  <sc-if value="{{ ncFormOpen }}" hint-placeholder-val="{{ false }}">
  <div style="position:absolute;inset:0;background:rgba(15,42,27,.35);display:flex;align-items:center;justify-content:center;z-index:65;padding:24px;">
    <div style="width:560px;max-width:100%;max-height:90%;overflow:auto;background:#fff;border-radius:20px;padding:26px 28px;box-shadow:0 24px 60px rgba(0,0,0,.25);">
      <div style="display:flex;align-items:center;margin-bottom:16px;">
        <div style="font-weight:900;font-size:19px;color:#0F2A1B;flex:1;">{{ ncFormTitle }}</div>
        <button onClick="{{ closeNcForm }}" style="border:0;background:#F0F2F7;color:#5a6b7e;border-radius:9px;width:32px;height:32px;cursor:pointer;font-family:inherit;font-weight:700;font-size:16px;">×</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        <sc-for list="{{ ncFormLines }}" as="l" hint-placeholder-count="2">
          <div style="display:flex;align-items:center;gap:10px;border:1px solid #E1E5EE;border-radius:12px;padding:10px 12px;">
            <div style="flex:1;min-width:0;"><div style="font-size:13.5px;font-weight:700;color:#0F2A1B;">{{ l.name }}</div><div style="font-size:12px;color:#7C95A8;">{{ l.priceStr }} c/u · {{ l.subtotalStr }}</div></div>
            <input value="{{ l.qtyStr }}" onInput="{{ l.onQty }}" inputmode="numeric" style="width:56px;text-align:center;border:1px solid #E1E5EE;border-radius:9px;padding:8px;font-family:inherit;font-size:14px;font-weight:700;color:#0F2A1B;outline:none;" />
            <button onClick="{{ l.onToggleRestock }}" title="Reponer stock" style="display:flex;align-items:center;gap:6px;border:0;background:transparent;font-family:inherit;font-size:12px;color:#5a6b7e;cursor:pointer;"><span style="{{ l.restockBoxStyle }}">{{ l.restockCheck }}</span>Stock</button>
          </div>
        </sc-for>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:12px;">
        <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Medio de devolución</label><select value="{{ ncFormMethod }}" onChange="{{ onNcMethod }}" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 12px;font-family:inherit;font-size:14px;font-weight:700;color:#0F2A1B;outline:none;background:#F8FAFC;cursor:pointer;box-sizing:border-box;"><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta (reverso)</option></select></div>
        <div style="flex:1;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Total a devolver</label><div style="border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-size:16px;font-weight:900;color:#c0392b;">{{ ncFormTotalStr }}</div></div>
      </div>
      <div style="margin-bottom:16px;"><label style="font-size:12.5px;font-weight:700;color:#5a6b7e;display:block;margin-bottom:5px;">Motivo</label><input value="{{ ncFormReason }}" onInput="{{ onNcReason }}" placeholder="Ej. producto defectuoso" style="width:100%;border:1px solid #E1E5EE;border-radius:11px;padding:11px 14px;font-family:inherit;font-size:14px;color:#0F2A1B;outline:none;box-sizing:border-box;" /></div>
      <div style="display:flex;gap:10px;">
        <button onClick="{{ closeNcForm }}" style="flex:none;border:1px solid #E1E5EE;background:#fff;color:#2A3A2E;border-radius:12px;padding:13px 20px;font-weight:700;font-size:15px;font-family:inherit;cursor:pointer;">Cancelar</button>
        <button onClick="{{ saveCreditNote }}" style="{{ ncSaveStyle }}">Emitir nota de crédito</button>
      </div>
    </div>
  </div>
  </sc-if>
```

> Para NC **manual** con ítems libres se requiere poder editar nombre y precio de la línea. Versión mínima acordada: la NC manual parte con una línea; si necesitas varias líneas o edición de nombre/precio, añadir inputs de nombre/precio y un botón "+ línea" reutilizando `onNcField` sobre `lines`. Mantener simple para v1: manual = una línea con nombre/precio editables. Si se implementa así, añadir inputs de nombre/precio en el `sc-for` y `addNcLine`/`onNcLineName`/`onNcLinePrice` análogos a `onNcLineQty`.

- [ ] **Step 4: Verificación manual**

Run: `pnpm tauri dev`
- Abrir caja. Historial → abrir una boleta → "Nota de crédito": líneas precargadas; ajustar qty, marcar/desmarcar "Stock", elegir método, motivo → "Emitir".
- Verificar en Stock que el producto con "Stock" marcado subió su inventario; el desmarcado no.
Expected: la NC se emite, repone stock según corresponda, y (con impresora) imprime el comprobante (C5).

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat(notas-credito): UI de emisión desde boleta y manual"
```

---

### Task C5: Comando Rust `print_credit_note` (TDD)

**Files:**
- Modify: `src-tauri/src/escpos.rs` (struct + `build_credit_note` + tests), `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `CreditNotePayload { negocio, folio, fecha, hora, sale_folio: Option<u32>, metodo, motivo, items: Vec<Item>, neto, iva, total }`; `pub fn build_credit_note(&CreditNotePayload) -> Vec<u8>`; comando `print_credit_note`.

- [ ] **Step 1: Test (falla)**

En `mod tests`:

```rust
    fn sample_nc() -> CreditNotePayload {
        let s = sample("efectivo", true);
        CreditNotePayload {
            negocio: s.negocio,
            folio: 501,
            fecha: "06/07/2026".into(), hora: "16:20".into(),
            sale_folio: Some(438),
            metodo: "efectivo".into(),
            motivo: "Producto defectuoso".into(),
            items: vec![Item { nombre: "Sansevieria".into(), qty: 1, precio: 9990 }],
            neto: 8395, iva: 1595, total: 9990,
        }
    }

    #[test]
    fn nc_init_corte_sin_gaveta() {
        let b = build_credit_note(&sample_nc());
        assert_eq!(&b[0..2], &[0x1B, 0x40]);
        assert!(contains(&b, &[0x1D, 0x56, 0x42, 0x00]));
        assert!(!contains(&b, &[0x1B, 0x70, 0x00, 0x19, 0xFA])); // sin gaveta
    }

    #[test]
    fn nc_incluye_textos() {
        let b = build_credit_note(&sample_nc());
        assert!(contains(&b, b"NOTA DE CREDITO"));
        assert!(contains(&b, b"No 501"));
        assert!(contains(&b, b"Ref. boleta: 438"));
        assert!(contains(&b, b"Sansevieria"));
        assert!(contains(&b, b"Producto defectuoso"));
    }
```

- [ ] **Step 2: Correr (falla)**

Run: `cd C:/Kromi/kromi-pos/src-tauri && cargo test nc_ 2>&1 | tail -20`
Expected: no compila (falta struct/fn).

- [ ] **Step 3: Implementar**

Struct (tras `QuotePayload`):

```rust
#[derive(Deserialize, Clone)]
pub struct CreditNotePayload {
    pub negocio: Negocio,
    pub folio: u32,
    pub fecha: String,
    pub hora: String,
    pub sale_folio: Option<u32>,
    pub metodo: String,
    pub motivo: String,
    pub items: Vec<Item>,
    pub neto: i64,
    pub iva: i64,
    pub total: i64,
}
```

`build_credit_note` (documento no tributario, sin gaveta):

```rust
pub fn build_credit_note(p: &CreditNotePayload) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(&[0x1B, 0x40]);
    b.extend_from_slice(include_bytes!("../assets/logo.escpos"));
    nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    push_text(&mut b, &format!("* {} *", p.negocio.tagline)); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);
    nl(&mut b);
    line_center(&mut b, &p.negocio.razon_social);
    nl(&mut b);

    box_ascii(&mut b, &[
        &format!("R.U.T.: {}", p.negocio.rut),
        "NOTA DE CREDITO",
        &format!("No {}", p.folio),
    ], 32);
    nl(&mut b);

    push_text(&mut b, &format!("Fecha: {} {}", p.fecha, p.hora)); nl(&mut b);
    if let Some(sf) = p.sale_folio {
        push_text(&mut b, &format!("Ref. boleta: {}", sf)); nl(&mut b);
    }
    push_text(&mut b, &format!("Motivo: {}", p.motivo)); nl(&mut b);
    rule(&mut b, b'-');

    b.extend_from_slice(&[0x1B, 0x45, 0x01]);
    line_lr(&mut b, "Item", "Subtotal", COL);
    b.extend_from_slice(&[0x1B, 0x45, 0x00]);
    rule(&mut b, b'=');
    for it in &p.items {
        line_lr(&mut b, &it.nombre, &money(it.precio * it.qty as i64), COL);
        push_text(&mut b, &format!("   {} x {}", it.qty, money(it.precio))); nl(&mut b);
    }
    rule(&mut b, b'=');

    line_lr(&mut b, "Neto", &money(p.neto), COL);
    line_lr(&mut b, "IVA 19%", &money(p.iva), COL);
    nl(&mut b);
    b.extend_from_slice(&[0x1D, 0x21, 0x11]);
    line_lr(&mut b, "DEVOLUCION", &money(p.total), 24);
    b.extend_from_slice(&[0x1D, 0x21, 0x00]);
    nl(&mut b);
    line_lr(&mut b, "Medio de devolucion", &p.metodo, COL);
    rule(&mut b, b'-');

    b.extend_from_slice(&[0x1B, 0x61, 0x01]);
    push_text(&mut b, "Documento no tributario"); nl(&mut b);
    push_text(&mut b, &p.negocio.footer); nl(&mut b);
    b.extend_from_slice(&[0x1B, 0x61, 0x00]);

    b.extend_from_slice(&[0x0A, 0x0A, 0x0A, 0x0A]);
    b.extend_from_slice(&[0x1D, 0x56, 0x42, 0x00]);
    b
}
```

En `lib.rs`: `use escpos::{CierrePayload, CreditNotePayload, QuotePayload, ReceiptPayload};`, comando:

```rust
#[tauri::command]
fn print_credit_note(payload: CreditNotePayload) -> Result<(), String> {
    let bytes = escpos::build_credit_note(&payload);
    let printer = payload.negocio.printer_name.clone();
    match printing::send_raw(&printer, &bytes) {
        Ok(()) => Ok(()),
        Err(_) => printing::send_raw(&printer, &bytes),
    }
}
```

Registro: `generate_handler![greet, print_receipt, print_cierre, print_quote, print_credit_note]`.

- [ ] **Step 4: Correr tests (pasan)**

Run: `cd C:/Kromi/kromi-pos/src-tauri && cargo test 2>&1 | tail -20`
Expected: PASA todo.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/escpos.rs src-tauri/src/lib.rs
git commit -m "feat(notas-credito): comando ESC/POS print_credit_note con tests"
```

---

### Task C6: Impresión de NC desde el frontend + comprobante de cierre con NC

**Files:**
- Modify: `src/index.html` (`printCreditNote`, `buildNcPayload`; `buildCierrePayload` con `nc_cash`/`nc_card`), `src-tauri/src/escpos.rs` (`build_cierre` incluye NC), test de cierre.

**Interfaces:**
- Consumes: `state.cfgRecibo`, `state.lastNc`.
- Produces: `printCreditNote(nc)`, `buildNcPayload(nc)`; `CierrePayload` extendido con `nc_cash`/`nc_card`; `build_cierre` resta NC del esperado y las lista.

- [ ] **Step 1: `buildNcPayload` + `printCreditNote` (frontend)**

Junto a `printCierre` agregar:

```js
  buildNcPayload = (nc) => {
    const cr = this.state.cfgRecibo;
    return {
      negocio: { tagline: cr.tagline, razon_social: cr.razonSocial, rut: cr.rut, giro: cr.giro, direccion: cr.direccion, footer: cr.footer, printer_name: cr.printerName, social: null },
      folio: nc.folio,
      fecha: this.fmtIsoDate(nc.dateIso), hora: nc.time,
      sale_folio: nc.saleFolio,
      metodo: nc.method,
      motivo: nc.reason || 'Sin motivo',
      items: nc.lines.map(l => ({ nombre: l.name, qty: l.qty, precio: l.price })),
      neto: nc.neto, iva: nc.iva, total: nc.total,
    };
  };
  printCreditNote = (nc) => {
    if (!nc) return;
    const tauri = window.__TAURI__;
    if (tauri && tauri.core && typeof tauri.core.invoke === 'function') {
      this.flashPrintToast({ ok: null, label: 'Imprimiendo nota de crédito…', retry: null });
      tauri.core.invoke('print_credit_note', { payload: this.buildNcPayload(nc) })
        .then(() => this.flashPrintToast({ ok: true, label: 'Nota de crédito impresa.', retry: null }))
        .catch(err => { console.error('print_credit_note:', err); this.flashPrintToast({ ok: false, label: 'No se pudo imprimir la nota de crédito.', retry: () => this.printCreditNote(nc) }); });
    } else { try { window.print(); } catch (e) {} }
  };
```

Reemplazar el stub de C2 si existiera.

- [ ] **Step 2: `buildCierrePayload` incluye NC**

En `buildCierrePayload` (~2492), agregar al objeto retornado:

```js
      nc_cash: rec.ncCash || 0,
      nc_card: rec.ncCard || 0,
```

- [ ] **Step 3: Extender `CierrePayload` y `build_cierre` en Rust (TDD)**

Test primero, en `escpos.rs` `mod tests` (ajustar `sample_cierre` para incluir los campos nuevos):

```rust
    #[test]
    fn cierre_incluye_notas_credito_y_ajusta_esperado() {
        let mut p = sample_cierre(0);
        p.nc_cash = 10000;
        p.nc_card = 0;
        // esperado = fondo(50000) + cash(142300) - nc_cash(10000) = 182300
        p.contado = 182300;
        let b = build_cierre(&p);
        assert!(contains(&b, b"Notas de credito"));
        assert!(contains(&b, b"CUADRADO (exacto)"));
    }
```

Correr: `cargo test cierre_incluye_notas 2>&1 | tail -20` → FALLA (campos/estructura).

Implementar: agregar a `CierrePayload` `pub nc_cash: i64,` y `pub nc_card: i64,`. En `build_cierre`, cambiar `esperado`:

```rust
    let esperado = p.fondo + p.cash - p.nc_cash;
```

Y en la sección de arqueo, tras "Ventas en efectivo", agregar:

```rust
    if p.nc_cash != 0 { line_lr(&mut b, "Notas de credito (efectivo)", &format!("-{}", money(p.nc_cash)), COL); }
    if p.nc_card != 0 { line_lr(&mut b, "Reversos tarjeta", &format!("-{}", money(p.nc_card)), COL); }
```

Actualizar `sample_cierre` para inicializar `nc_cash: 0, nc_card: 0` (así los tests previos siguen pasando: esperado sin NC = fondo+cash como antes).

Correr `cargo test` → PASA todo.

- [ ] **Step 4: Verificación manual (end-to-end del cierre con NC)**

Run: `pnpm tauri dev`
- Abrir caja, 1 venta efectivo $10.000, 1 NC efectivo $4.000. Cerrar caja.
Expected: en pantalla el "Esperado en caja" = fondo + 10.000 − 4.000; el comprobante impreso lista "Notas de credito (efectivo) -4.000" y el arqueo cuadra sin marcarse como faltante.

- [ ] **Step 5: Commit**

```bash
git add src/index.html src-tauri/src/escpos.rs
git commit -m "feat(notas-credito): impresión NC y comprobante de cierre con NC"
```

---

### Task C7: Pestaña "Notas de crédito" en Historial

**Files:**
- Modify: `src/index.html` (tabs de historial ~793–884, bindings, bloque de plantilla)

**Interfaces:**
- Consumes: `state.creditNotes`, `state.histTab`.
- Produces: tercer tab `histTab === 'notas'`; bindings `histTabNotas*`, `ncHistoryRows`, `histNcCount`.

- [ ] **Step 1: Agregar el tercer tab**

Junto a los tabs Ventas/Cierres del historial (~793–884), agregar un tab "Notas de crédito" con `onClick` a `goHistNotas` y estilo análogo. Handler:

```js
  goHistNotas = () => this.setState({ histTab: 'notas' });
```

- [ ] **Step 2: Bindings**

```js
      histTabNotas: S.histTab === 'notas',
      goHistNotas: this.goHistNotas,
      histNcCountStr: S.creditNotes.length + (S.creditNotes.length === 1 ? ' nota' : ' notas'),
      ncHistoryRows: S.creditNotes.map(n => ({
        id: n.id,
        folioStr: 'NC-' + n.folio,
        dateStr: this.fmtIsoDate(n.dateIso) + ' · ' + n.time,
        refStr: n.saleFolio ? ('Boleta ' + n.saleFolio) : 'Manual',
        methodStr: n.method === 'efectivo' ? 'Efectivo' : 'Tarjeta',
        reason: n.reason || '—',
        totalStr: '-' + this.fmt(n.total),
        onReprint: () => this.printCreditNote(n),
      })),
      ncHistEmpty: S.creditNotes.length === 0,
```

Además, incluir el estilo del tab (mirar `histTabCierresStyle` ~793 y replicar con color rojo/acento).

- [ ] **Step 3: Bloque de plantilla de la lista de NC**

Dentro del área de Historial, agregar el bloque condicionado a `histTabNotas` (imitar la lista de cierres ~882–927):

```html
      <sc-if value="{{ histTabNotas }}" hint-placeholder-val="{{ false }}">
      <div style="display:flex;flex-direction:column;gap:10px;">
        <sc-for list="{{ ncHistoryRows }}" as="n" hint-placeholder-count="4">
          <div style="display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #E1E5EE;border-radius:14px;padding:16px 18px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:14.5px;font-weight:800;color:#0F2A1B;">{{ n.folioStr }} · {{ n.refStr }}</div>
              <div style="font-size:12.5px;color:#7C95A8;margin-top:2px;">{{ n.dateStr }} · {{ n.methodStr }} · {{ n.reason }}</div>
            </div>
            <div style="font-size:16px;font-weight:900;color:#c0392b;">{{ n.totalStr }}</div>
            <button onClick="{{ n.onReprint }}" style="border:1px solid #E1E5EE;background:#fff;color:#5a6b7e;border-radius:10px;padding:8px 12px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;">Reimprimir</button>
          </div>
        </sc-for>
        <sc-if value="{{ ncHistEmpty }}" hint-placeholder-val="{{ false }}"><div style="padding:34px 22px;text-align:center;font-size:13.5px;color:#9aa8bd;">No hay notas de crédito registradas.</div></sc-if>
      </div>
      </sc-if>
```

- [ ] **Step 4: Verificación manual**

Run: `pnpm tauri dev`
- Emitir una NC → Historial → tab "Notas de crédito".
Expected: aparece la NC con folio NC-501, referencia (boleta o Manual), método, motivo y total en rojo; "Reimprimir" reimprime el comprobante.

- [ ] **Step 5: Commit**

```bash
git add src/index.html
git commit -m "feat(notas-credito): pestaña de historial de notas de crédito"
```

---

## Verificación final (todas las fases)

- [ ] `cd C:/Kromi/kromi-pos/src-tauri && cargo test` → todos verdes.
- [ ] `pnpm tauri dev` sin errores en consola.
- [ ] Proveedores: crear/editar/activar, asociar a producto, ver en ambas fichas.
- [ ] Cotización: crear desde carrito → imprimir térmica → PDF (A4) → convertir a venta (queda "Convertida").
- [ ] NC desde boleta: restock por línea, método efectivo reduce "Esperado en caja" sin descuadre; método tarjeta como reverso informativo; comprobante impreso; aparece en Historial.
- [ ] NC manual bloqueada si la caja está cerrada.

---

## Self-review (hecho por el autor del plan)

**Cobertura del spec:** Proveedores (A1–A5: modelo, CRUD, pantalla, ficha completa, asociación) ✓; Cotizaciones (B1–B6: estado/vigencia 7d, crear, listar, imprimir, PDF opción A, convertir) ✓; Notas de crédito (C1–C7: estado, handlers ambas fuentes, restock por línea, integración cierre efectivo/tarjeta sin pérdida, UI boleta+manual, requiere caja abierta, impresión, historial) ✓; Rust `print_quote`/`print_credit_note` + cierre con NC ✓.

**Nota de riesgo (documentada, no placeholder):** el restock y la conversión de cotización hacen match de producto **por nombre** (las líneas de venta/cotización no guardan `id`). Es la decisión del spec; con nombres duplicados podría fallar. Alternativa futura: guardar `productId` en las líneas.

**Consistencia de tipos:** claves de estado (`suppliers/supForm/quotes/quoteSeq/creditNotes/ncSeq/ncForm/convertingQuoteId/lastNc`) y firmas de handlers son coherentes entre tareas; los comandos Rust y sus payloads coinciden con los `build*Payload` del frontend.
