# `_legacy/` — CÓDIGO CONGELADO (no se carga en producción)

> Estado: **CONGELADO / SOLO REFERENCIA HISTÓRICA**
> Última verificación: 2026-05-31

## Qué es esto

Esta carpeta contiene la versión monolítica anterior del ERP VentasHera, previa
a la modularización en `src/js/modules/`. Se conserva únicamente como **referencia
histórica**.

## Evidencia de que NO está activa

- `index.html` **no carga** ningún archivo de `src/js/_legacy/` (verificado: no hay
  ninguna etiqueta `<script src=".../_legacy/...">`).
- Ningún módulo activo de `src/js/modules/` importa o referencia `_legacy`
  (búsqueda de la cadena `_legacy` en el código activo: 0 coincidencias).
- La app activa se sirve desde esta carpeta de trabajo
  (`ventashera-main/ventashera/index.html` + `src/js/modules/`).

## Duplicados conocidos respecto al código activo (NO usar los de aquí)

| Símbolo                | Versión ACTIVA (canónica)                          | Copia muerta aquí                          |
|------------------------|----------------------------------------------------|--------------------------------------------|
| `procesarVentaPOS`     | `src/js/modules/core.js`                            | `_legacy/features/pos.js`                  |
| `renderHistorial`      | `src/js/modules/core.js` → `game-system-module.js`  | `_legacy/features/sistema-config.js`       |
| parsers de `invoices.items` | `repository.js` (`articuloIdFromInvoiceItem`) + `core.js` | `_legacy/platform.js`               |

## Reglas

1. **No se carga en producción.** No agregar `<script>` que apunte aquí.
2. **No modificar** estos archivos salvo una migración explícita y documentada.
3. Si necesitas lógica de aquí, **portarla** al módulo activo correspondiente; no
   reactivar la carpeta.
4. Eliminación definitiva: sólo en una fase posterior, tras confirmar de nuevo que
   sigue sin referencias y con respaldo en git.

## Por qué no se borra todavía

Es deuda técnica inerte (no estorba en runtime). Borrarla ahora no reduce riesgo
operativo (ventas/caja/inventario/facturas no dependen de ella) y sí elimina una
referencia histórica útil. Queda como candidato a borrado en una fase futura.
