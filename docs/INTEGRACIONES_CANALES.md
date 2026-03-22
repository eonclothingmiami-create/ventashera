# Integraciones de canales (sin solaparse)

Objetivo: que **Mercado Libre**, **Meta Commerce** y futuras integraciones **no compartan lógica ni dependan una de la otra**.

## Reglas

1. **Un canal = un bloque aislado**
   - **Edge Function** propia en `supabase/functions/<nombre-canal>/` (no un “sync genérico” para todos).
   - **Secrets** con prefijo único (`ML_*`, `META_*`, …) en Supabase.
   - **Script cliente** propio en `src/js/integrations/<nombre>.js` exponiendo solo `window.request…` para ese canal.

2. **Sin acoplamiento**
   - No importar código de un canal dentro del otro.
   - No reutilizar el mismo token ni el mismo ID de catálogo entre plataformas.

3. **Tras guardar artículo**
   - Cada canal se ejecuta en **su propio `try/catch`**.
   - Un **error en un canal** no impide ejecutar el siguiente (solo añade nota / notificación de ese canal).
   - Orden actual: primero ML, luego Meta (secuencial; evita condiciones de carrera sobre el mismo `productId`).

4. **UI**
   - Casilla y copy **por canal**; el usuario decide cuáles activar al guardar.

5. **Añadir un canal nuevo**
   - Nuevo archivo en `integrations/` + nueva Edge Function + checkbox + una función `postSave…Integration` en `core.js` que **no** modifique las existentes salvo el ensamblado final del mensaje de guardado.

## Archivos de referencia

| Canal | Cliente | Edge Function |
|-------|---------|---------------|
| Mercado Libre | `mercadolibre.js` | `mercadolibre-sync-product` |
| Meta Commerce | `meta-commerce.js` | `meta-commerce-sync` |

## Mensaje de guardado

El texto final concatena notas opcionales (`mlNote`, `metaNote`, …); cada una solo refleja **su** canal.
