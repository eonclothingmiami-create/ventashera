# Plan de limpieza post-consolidación `sale_items`

> Limpieza quirúrgica, no estética. Objetivo: reducir riesgo operativo sin afectar
> ventas, caja, inventario ni facturas. **Nada crítico se elimina en esta fase.**
> Fecha: 2026-05-31

Entregables relacionados:
- `supabase/audits/sales_consolidation_cleanup_audit.sql` (Fase 1, sólo SELECT).
- `supabase/audits/sales_duplicate_cleanup_candidates.sql` (Fase 4, sólo etiquetado).
- `src/js/_legacy/README.md` (Fase 3, congelamiento documentado).

---

## Fase 2 — Auditoría de código duplicado / legacy

### 2.1 Código legacy no cargado (`src/js/_legacy/*`)

**Hallazgo:** la carpeta `src/js/_legacy/` contiene 17 archivos (versión monolítica
previa). **No está cargada ni referenciada.**

- `index.html` no incluye ningún `<script>` que apunte a `_legacy/`.
- Búsqueda de la cadena `_legacy` en todo el código: **0 coincidencias** en módulos
  activos / `index.html` / `core.js`.
- `_legacy/init.js` sólo define `window.onload = () => loadState()`, que tampoco se
  carga.

| Elemento | Clasificación |
|---|---|
| `src/js/_legacy/**` (todos) | **MOVER a archivo histórico** (congelado vía README; borrado definitivo en fase futura) |

### 2.2 Funciones duplicadas

| Función / lógica | Fuente CANÓNICA (activa) | Duplicado(s) | Clasificación |
|---|---|---|---|
| `procesarVentaPOS` | `src/js/modules/core.js` (línea ~3981) | `_legacy/features/pos.js` (~384) | Duplicado en legacy: **SEGURO archivar** (legacy congelado). El activo: **NO tocar**. |
| `renderHistorial` | `core.js` (~8635) que delega en `game-system-module.js` (`renderHistorial(ctx)`) | `_legacy/features/sistema-config.js` (~5) | Legacy: **SEGURO archivar**. Activo (core+módulo): **NO tocar** (core es fallback del módulo, no es duplicado real). |
| Parsers de `invoices.items` | `repository.js` → `articuloIdFromInvoiceItem` (helper global canónico) | Re-implementaciones inline en `core.js` (mapFn `facturas`, carga de `state.facturas`), `pos-repository.js` (`preparePosSaleForPersist`, `buildSaleItemRows`), `treasury-module.js`, `separados-module.js`; copia muerta en `_legacy/platform.js` | Activos: **NO tocar todavía** (consolidar en fase futura tras `sale_items`). Legacy: **archivar**. |
| Mapeo `ventas`/`invoices` (BD↔estado) | `COLLECTION_MAP` en `core.js` (~3063, escritura) | Dos mapeos de **lectura** distintos: "ventasSlice" (`core.js` ~2433/2461) y carga completa (`core.js` ~2715/2730) | **NO tocar todavía** — requiere validación; son rutas de carga reales (parcial vs completa), no basura. Marcar para unificación futura. |
| Lógica ventas-mes / dashboard | `core.js` (`ventasMesCalendario`, `tesVentaPosMetricsForMonth`, `renderDashboard`) | — (sin duplicado activo detectado) | **NO tocar**. |

**Nota importante (no es duplicado, es delegación):** `core.js::renderHistorial` y
`core.js::saveRecord`-relacionados delegan a módulos `App*`. Eso es el patrón de
arquitectura del proyecto (core orquesta, módulos implementan), **no** código a borrar.

### 2.3 Carpetas duplicadas

La app activa es: **`.../ERP/ventashera-main/ventashera/`** (contiene el `index.html`
y `src/js/modules/` modificados más recientemente; es la raíz del workspace).

Se detectaron copias **FUERA del workspace activo** (no se deben tocar desde aquí):

| Ruta | Naturaleza | Clasificación |
|---|---|---|
| `.../ERP/ventashera-main/ventashera/` | **APP ACTIVA** (workspace) | **NO tocar** (es la de producción) |
| `.../ERP/ventashera-main/ventashera-main/` | Copia anidada hermana | **REQUIERE VALIDACIÓN MANUAL** (confirmar que no se sirve; fuera del workspace) |
| `.../ERP/ventashera-main/commercial-presentation/` | Otro proyecto | NO relevante |
| `.../ERP/ventashera-main/node_modules/` | Dependencias | NO tocar |
| `.../ERP/ventashera-git/`, `.../ERP/ventashera-next/`, `ventashera-main2.zip` | Copias/backbesups históricos | **REQUIERE VALIDACIÓN MANUAL** (no borrar sin confirmar despliegue) |

> No ejecuto ningún borrado de estas carpetas: están fuera del directorio de trabajo
> y borrarlas podría afectar un despliegue o backup que desconozco.

---

## Fase 5 — Reporte final

### 5.1 Duplicados DETECTABLES (verificar con `sales_consolidation_cleanup_audit.sql`)

Datos (a confirmar ejecutando el SQL en Supabase; no ejecutado aquí):
- Ventas: misma `referencia`, mismo `invoice_id`, mismo cliente+fecha+total+canal; ventas sin factura; facturas POS sin venta.
- Facturas: mismo `number`, mismo cliente+fecha+total; POS sin `items`.
- `sale_items`: por `line_key` y por invoice+product+talla+qty+precio; sin sale_id/invoice_id/product_id.
- `stock_moves`: repetidos por documento+product+tipo+qty+ref; ventas sin moves; anuladas con neto < 0.
- `tes_movimientos`: repetidos por concepto+fecha+valor+categoria (excluyendo mixto por `metodo`); ventas sin ingreso; contraentrega con >1 ingreso.

### 5.2 Duplicados CONFIRMADOS (por código, sin ejecutar SQL)

- **Código legacy duplicado y muerto**: `procesarVentaPOS`, `renderHistorial` y parsers
  en `src/js/_legacy/*`. Confirmado sin referencias. **Seguro de archivar.**

### 5.3 Cosas que estorban pero NO se deben borrar todavía

- Parsers de `invoices.items` repetidos en módulos activos → consolidar en `articuloIdFromInvoiceItem` en una fase futura (riesgo de tocar POS/facturas ahora).
- Dos rutas de mapeo de carga (`ventasSlice` vs carga completa) en `core.js`.
- Carpetas hermanas/zip fuera del workspace.

### 5.4 Cosas SEGURAS de archivar

- `src/js/_legacy/**` → ya **congelado** con `README.md` (Fase 3). Borrado definitivo en fase posterior.
- `sale_items` duplicados por `line_key` (tabla secundaria) → archivables vía la
  plantilla comentada en `sales_duplicate_cleanup_candidates.sql` (con backup + `archived=true`, nunca DELETE).

### 5.5 Riesgos de eliminar cada cosa

| Acción | Riesgo |
|---|---|
| Borrar `_legacy/` ahora | Bajo en runtime, pero se pierde referencia histórica; mejor archivar primero. |
| Tocar parsers `invoices.items` activos | **Alto**: afecta POS, facturas, sale_items y reportes. |
| Borrar filas en `ventas`/`invoices` | **Crítico**: afecta dinero y trazabilidad. Sólo `archived=true` con backup. |
| Borrar `stock_moves` duplicados | **Crítico**: cambia inventario neto. Sólo manual y con auditoría. |
| Borrar `tes_movimientos` duplicados | **Crítico**: cambia saldos de caja. Sólo manual. |
| Borrar `sale_items` duplicados | Bajo (tabla secundaria), pero igual con backup + `archived`. |
| Borrar carpetas hermanas/zip | Desconocido: pueden ser despliegue/backup. Validación manual. |

### 5.6 Próximo paso recomendado

1. Ejecutar `sales_consolidation_cleanup_audit.sql` en Supabase y pegar los conteos.
2. Con esos números, decidir si hace falta la migración de archivado de `sale_items`
   (sólo esa tabla es candidata automática segura).
3. Para `ventas`/`invoices`/`stock_moves`/`tes_movimientos`: revisar manualmente los
   candidatos `REQUIERE_VALIDACION_MANUAL` antes de cualquier acción.
4. Dejar `_legacy/` congelado un ciclo más; borrarlo en una fase futura tras reconfirmar 0 referencias.

### Criterio de éxito (cumplido en esta fase)

- No se eliminó nada crítico. ✅
- Quedan documentados: qué duplicados existen, qué código está muerto (`_legacy`),
  qué sigue activo (módulos + `core.js`) y qué limpieza es segura a futuro. ✅
- Ventas, caja, inventario y facturas siguen cuadrando (no se tocó ningún flujo). ✅
