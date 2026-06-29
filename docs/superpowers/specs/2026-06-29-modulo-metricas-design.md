# Diseño — Módulo Métricas (analítica de negocio)

**Fecha:** 2026-06-29
**Pantalla:** nueva `screen === 'metricas'` (admin), entrada en el menú de administración.
**Objetivo:** Convertir datos crudos de venta en **insights accionables**: cuándo se vende más (hora/día), estacionalidad por mes, y qué categorías/productos rinden. Justifica el módulo "Métricas" del catálogo.

## Contexto

- Hoy el Historial muestra reporting crudo (ventas por hora del día actual, totales). No hay analítica.
- El seed real es ~1 día (`lun 23 jun`) + ventas embebidas en cierres → insuficiente para día-de-semana/estacionalidad.

## Datos — generador determinista

`buildMetrics()` (PRNG con semilla fija → estable entre recargas; **no** usa `Math.random`/`Date.now` para que la demo sea reproducible) produce **12 meses de resúmenes diarios** livianos:
```
{ dateIso, weekday (0=Dom..6=Sab), month (0..11), total, byHour: {9..20: monto}, byCat: {catKey: monto} }
```
Patrones realistas para un vivero:
- **Hora**: curva con peaks a mediodía (12–14) y media tarde (17–19).
- **Día de semana**: fin de semana (Vie–Dom) más alto.
- **Estacionalidad**: primavera/verano (sep–feb, hemisferio sur) por sobre otoño/invierno.
- **Categorías**: pesos distintos + sesgo horario (suculentas/exterior más de mañana; interior pareja).

Todas las vistas derivan de estos resúmenes (consistencia garantizada). Se calcula una vez al render (memo simple por ahora; barato).

## Pantalla "Métricas" (admin)

- Nueva `screen === 'metricas'`; se agrega a `adminScreens` y al menú admin con ícono.
- La entrada del menú **se muestra solo si el módulo Métricas está activo** (`cfgModules.metricas && !modulePending.metricas`) — primer caso donde el sistema de módulos gatea navegación.

## Secciones (v1)

1. **Resumen** — KPIs (12m): venta total, ticket promedio, **día más fuerte**, **hora pico**, **mes top**.
2. **Horarios pico** — heatmap **día de la semana (filas) × hora 09–20 (columnas)**; intensidad de color por monto, con leyenda. Lectura: cuándo reforzar atención.
3. **Día de la semana + tendencia** — barras por día (Lun…Dom, promedio) + mini-línea (SVG) de tendencia de las últimas ~8 semanas.
4. **Estacionalidad por mes** — 12 barras (ene…dic) con el mes pico resaltado.
5. **Productos y categorías** — ranking de **categorías** (barras, mayor→menor) y un detalle de **franja horaria** (mañana / mediodía / tarde) con la categoría dominante de cada franja.

## Técnica

- Gráficos con **divs/SVG inline** (mismo enfoque que el historial; sin librerías; coherente con entorno offline).
- Helpers de color para el heatmap (escala por intensidad).
- Todo en `src/index.html`. Sin tocar Rust.

## Criterios de aceptación

1. Existe una pantalla Métricas accesible desde admin, visible solo si el módulo está activo.
2. El heatmap muestra hora × día con intensidad coherente (peaks mediodía/tarde, fin de semana más fuerte).
3. Día de la semana, estacionalidad mensual y ranking de categorías se ven poblados y consistentes entre sí.
4. Los KPIs (día fuerte, hora pico, mes top) coinciden con lo que muestran las vistas.
5. Los datos son estables entre recargas (generador determinista).

## Fuera de alcance v1

- Filtro de período configurable (ventana fija 12 meses).
- Comparativa año-contra-año, exportar, drill-down por producto individual.
- Persistencia (los resúmenes se generan en memoria).
