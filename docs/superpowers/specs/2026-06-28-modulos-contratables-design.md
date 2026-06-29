# Diseño — Módulos contratables (alta/baja con precio, confirmación y aviso)

**Fecha:** 2026-06-28
**Pantalla:** Configuración › Módulos (`cfgSection === 'modulos'`, admin)
**Objetivo:** Que el administrador pueda habilitar/deshabilitar módulos libremente, viendo el precio, confirmando la acción y recibiendo un aviso por correo (simulado en el prototipo). La baja mantiene el servicio hasta fin del mes en curso y deja de cobrarse desde el mes siguiente.

## Contexto

- `src/index.html`. Hoy la sección es una lista con toggles simples: `cfgModDefs` (key/título/desc), estado `cfgModules` (mapa booleano, todos `true`) y `toggleCfgModule` (flip directo, sin precio ni confirmación).
- Datos en memoria. No hay backend de correo ni reloj que avance el tiempo.

## Decisiones de alcance

- **Correo: simulado.** Cada alta/baja registra un evento y la UI confirma "enviamos un correo a `<adminEmail>`". El envío real (SMTP) queda como tarea de backend (requiere credenciales → límite de autonomía).
- **Baja: hasta fin del mes en curso.** El módulo queda activo hasta el último día del mes; desde el día 1 del mes siguiente se desactiva y no se cobra. Cómputo automático, sin fecha configurable.
- Solo admin (vive en Configuración).

## Catálogo con precio

`cfgModDefs` se extiende con precio mensual (CLP). El módulo Venta es base (siempre incluido, no aparece).

| key | Módulo | Precio/mes |
|---|---|---|
| stock | Stock e inventario | 12000 |
| clientes | Clientes y fidelización | 15000 |
| historial | Historial y métricas | 9000 |
| categorias | Categorías | 6000 |

## Modelo de estado

- `cfgModules: { key: bool }` — módulo **activo** (servicio disponible). Se mantiene.
- `modulePending: { key: endLabel }` — bajas programadas; el módulo sigue activo pero con corte al `endLabel` (último día del mes en curso).
- `adminEmail` — correo del admin para el aviso (sembrado, p. ej. `admin@plantaconmati.cl`).
- `moduleConfirm: { key, action } | null` — modal de confirmación (`action` = `'enable' | 'disable'`).
- `moduleBanner: string | null` — banner transitorio de resultado.
- `moduleNotices: []` — log de avisos simulados (`{ key, action, email, at }`).

## Interacción (el toggle abre un modal, no cambia solo)

`openModuleConfirm(key)` decide la acción según estado actual:
- inactivo → `enable` (contratar).
- activo sin baja → `disable` (dar de baja).
- activo con baja programada → `enable` (reactivar / anular baja).

`confirmModule()` aplica:
- **enable (contratar):** `cfgModules[key]=true`, borra `modulePending[key]`; banner *"Módulo «título» contratado. Enviamos un correo de confirmación a `<adminEmail>`."*; push a `moduleNotices`.
- **enable (reactivar):** igual pero banner *"Baja anulada · «título» sigue activo."* (sin cobro nuevo a mitad de ciclo).
- **disable (baja):** **mantiene** `cfgModules[key]=true`, set `modulePending[key]=endLabel`; banner *"«título» seguirá activo hasta el `<endLabel>`; desde el `<next1Label>` se desactiva y se deja de cobrar. Te enviamos un correo."*; push a `moduleNotices`.

`endLabel` = último día del mes en curso (`new Date(y, m+1, 0)`, formato "30 jun"). `next1Label` = día 1 del mes siguiente ("1 jul").

## UI de la sección

Cada fila: título + descripción + **precio/mes** + **chip de estado** (Activo / Inactivo / Baja programada · activo hasta DD mmm) + toggle (verde activo, ámbar baja programada, gris inactivo).
- **Banner** de resultado arriba de la lista, descartable.
- **Pie**: **Total mensual** = suma de precios de módulos activos **no** dados de baja.

## Modal de confirmación

Reutiliza el patrón de modales existente. Dos variantes según `action`:
- **Contratar:** ícono + "Contratar «título»", muestra precio/mes y la línea "Se enviará un correo de confirmación a `<adminEmail>`". Botones Cancelar / Confirmar contratación (verde).
- **Dar de baja:** ícono de aviso + "Dar de baja «título»", explica el corte (activo hasta `<endLabel>`, sin cobro desde `<next1Label>`). Botones Cancelar / Dar de baja.

## Criterios de aceptación

1. Cada módulo muestra su precio/mes y un chip de estado.
2. Activar un módulo inactivo pide confirmación con el precio, lo activa y muestra el banner de correo enviado.
3. Dar de baja un módulo activo lo deja **activo** con chip "Baja programada · activo hasta `<fin de mes>`" y registra el aviso; el Total mensual deja de sumarlo.
4. Reactivar un módulo en baja anula la baja sin nuevo cobro.
5. El Total mensual refleja solo los módulos activos no dados de baja.

## Fuera de alcance

- Envío real de correo (SMTP/servicio) — requiere credenciales; tarea de backend.
- Fecha de facturación configurable (se usa fin de mes en curso).
- Persistencia y avance real del ciclo (sin reloj que desactive al llegar el día 1).
- Prorrateo de cobros.
