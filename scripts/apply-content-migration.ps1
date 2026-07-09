# Aplica migración catalog_content_posts en Supabase SQL Editor
# (MCP/CLI en modo read-only desde este entorno)

$ErrorActionPreference = 'Stop'
$sql = Join-Path $PSScriptRoot '..\supabase\migrations\20260710130000_catalog_content_posts.sql'
if (-not (Test-Path $sql)) { throw "No se encontró: $sql" }

Write-Host @"

=== Migración Contenido editorial ===

1. Abre: https://supabase.com/dashboard/project/niilaxdeetuzutycvdkz/sql/new
2. Pega el contenido de:
   $sql
3. Ejecuta (Run)

Verificación:
  SELECT to_regclass('public.catalog_content_posts');
  -- debe devolver catalog_content_posts

"@

Get-Content $sql -Raw | Set-Clipboard
Write-Host "SQL copiado al portapapeles." -ForegroundColor Green
