# VentasHera (HERA)

## ERP (interfaz web)

- **`index.html`** — entrada del ERP. Sirve esta carpeta con un servidor HTTP local (por ejemplo `npx serve .` desde la raíz del proyecto) para que los scripts y estilos carguen bien.
- **`src/js/`** — lógica modular (`modules/core.js`, `modules/app/*`, integraciones).
- **`src/styles/`** — estilos (`main.css`).

Credenciales y URL de Supabase se configuran en el propio ERP (según `repository.js`).

## Backend (Supabase)

Todo lo del proyecto Supabase está en **`supabase/`**:

- Migraciones: `supabase/migrations/`
- Edge Functions: `supabase/functions/`
- Diagnósticos SQL: `supabase/queries/`

Resumen del backend: [supabase/README.md](./supabase/README.md) · historial y backups: [supabase/BACKEND_ACTUALIZACIONES.md](./supabase/BACKEND_ACTUALIZACIONES.md)

## Nota sobre carpetas

Si ves **`index.html`** o **`src`** solo dentro de `supabase/`, conviene **moverlos a esta raíz** (junto a `package.json`) para que las rutas `./src/...` del HTML coincidan con el diseño del proyecto.
