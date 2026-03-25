# VentasHera ERP (Modularizado)

Proyecto ERP web (HTML + CSS + JS vanilla) reorganizado por módulos para crecer de forma ordenada, manteniendo la lógica original.

## Estructura

```text
/
├─ index.html
├─ index (1).html                  # Archivo original que tenías
├─ index.backup.inline.html        # Backup del HTML previo a modularización
├─ src/
│  ├─ styles/
│  │  └─ main.css
│  └─ js/
│     ├─ full.inline.backup.js     # Backup del JS completo en una sola pieza
│     ├─ core/
│     │  ├─ platform.js
│     │  └─ init.js
│     └─ features/
│        ├─ dashboard.js
│        ├─ pos.js
│        ├─ articulos.js
│        ├─ inventario-movimientos.js
│        ├─ documentos.js
│        ├─ usuarios.js
│        ├─ logistica-cobros.js
│        ├─ payroll.js
│        ├─ tesoreria.js
│        ├─ gamificacion.js
│        ├─ sistema-config.js
│        └─ separados.js
└─ .gitignore
```

## Qué cambió

- El CSS inline se movió a `src/styles/main.css`.
- El JS inline se partió en módulos por feature cargados en orden desde `index.html`.
- Se preservó la lógica original del sistema para no romper flujos existentes.

## Cómo correrlo local

1. Abre `index.html` en el navegador.
2. Recomendado: usar un servidor local simple para evitar restricciones del navegador con archivos locales.
3. Verifica en consola que no haya errores al cargar los módulos.

## Subir a GitHub

1. Inicializa repo (si no existe):
   `git init`
2. Agrega archivos:
   `git add .`
3. Commit:
   `git commit -m "refactor: modulariza VentasHera ERP en archivos CSS/JS"`
4. Conecta remoto:
   `git remote add origin <TU_URL_GITHUB>`
5. Sube:
   `git push -u origin main`

## Integraciones de catálogo (opcional)

Principios para que **no se solapen** entre sí: [`docs/INTEGRACIONES_CANALES.md`](docs/INTEGRACIONES_CANALES.md).

- **Mercado Libre**: Edge Function `mercadolibre-sync-product`, script `src/js/integrations/mercadolibre.js`.
- **Meta Commerce Manager** (Facebook Shops / Instagram Shopping): Edge Function `meta-commerce-sync`, script `src/js/integrations/meta-commerce.js`. Guía: [`docs/META_COMMERCE_MANAGER.md`](docs/META_COMMERCE_MANAGER.md).

## Nota

- Conservé backups (`index.backup.inline.html` y `src/js/full.inline.backup.js`) para seguridad.
- Cuando confirmes que todo te funciona al 100%, puedes borrarlos si quieres un repo más limpio.
