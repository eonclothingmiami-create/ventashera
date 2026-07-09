# Aplica migraciones de Contenido editorial en Supabase SQL Editor

$ErrorActionPreference = 'Stop'
$migrations = @(
  '20260710130000_catalog_content_posts.sql',
  '20260710150000_catalog_content_dual_cta_whatsapp.sql'
)

Write-Host @"

=== Migraciones Contenido editorial ===

1. Abre: https://supabase.com/dashboard/project/niilaxdeetuzutycvdkz/sql/new
2. Ejecuta cada archivo en orden (si la tabla ya existe, solo necesitas el segundo):

"@

foreach ($name in $migrations) {
  $sql = Join-Path $PSScriptRoot "..\supabase\migrations\$name"
  if (-not (Test-Path $sql)) { throw "No se encontró: $sql" }
  Write-Host "  - $name"
}

$latest = Join-Path $PSScriptRoot "..\supabase\migrations\20260710150000_catalog_content_dual_cta_whatsapp.sql"
Get-Content $latest -Raw | Set-Clipboard
Write-Host "`nSQL del CTA dual + WhatsApp copiado al portapapeles." -ForegroundColor Green
