# Reencola push de productos actualizados hoy y dispara envío FCM.
# Requiere la Edge Function catalog-push-replay desplegada en Supabase.
#
# Uso:
#   .\scripts\replay-catalog-push-today.ps1
#   .\scripts\replay-catalog-push-today.ps1 -Date "2026-07-07"

param(
  [string]$Date = "",
  [string]$ProjectRef = "niilaxdeetuzutycvdkz",
  [string]$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c"
)

$ErrorActionPreference = "Stop"

if (-not $Date) {
  $Date = (Get-Date).ToUniversalTime().AddHours(-5).ToString("yyyy-MM-dd")
}

$uri = "https://$ProjectRef.supabase.co/functions/v1/catalog-push-replay"
$body = @{ date = $Date } | ConvertTo-Json

Write-Host "Replay push FCM - fecha Bogota: $Date" -ForegroundColor Cyan

$resp = Invoke-RestMethod -Uri $uri -Method POST -Headers @{
  apikey        = $AnonKey
  Authorization = "Bearer $AnonKey"
  "Content-Type" = "application/json"
} -Body $body

$resp | ConvertTo-Json -Depth 8

if ($resp.sent_total -gt 0) {
  Write-Host "`nOK: Firebase acepto $($resp.sent_total) envio(s)." -ForegroundColor Green
} elseif ($resp.enqueued -gt 0) {
  Write-Host "`nEventos encolados ($($resp.enqueued)). Revisa dispatch en la respuesta." -ForegroundColor Yellow
} else {
  Write-Warning "No se encolaron productos para la fecha indicada."
}
