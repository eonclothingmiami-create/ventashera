# Reencola push FCM para productos visibles actualizados en un rango de fechas (America/Bogota).
# Requiere la Edge Function catalog-push-replay desplegada en Supabase.
#
# Uso:
#   .\scripts\replay-catalog-push-range.ps1 -From "2026-07-01" -To "2026-07-09"
#   .\scripts\replay-catalog-push-range.ps1  # default: jul 1 hasta hoy Bogota

param(
  [string]$From = "2026-07-01",
  [string]$To = "",
  [string]$ProjectRef = "niilaxdeetuzutycvdkz",
  [string]$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paWxheGRlZXR1enV0eWN2ZGt6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjc0NjIsImV4cCI6MjA4ODk0MzQ2Mn0.GI8E7vRzxi5NumN_f4T432Lx4BcmgGLZo81BR9h3h8c"
)

$ErrorActionPreference = "Stop"

if (-not $To) {
  $To = (Get-Date).ToUniversalTime().AddHours(-5).ToString("yyyy-MM-dd")
}

$uri = "https://$ProjectRef.supabase.co/functions/v1/catalog-push-replay"
$headers = @{
  apikey        = $AnonKey
  Authorization = "Bearer $AnonKey"
  "Content-Type" = "application/json"
}

$start = [datetime]::ParseExact($From, "yyyy-MM-dd", $null)
$end = [datetime]::ParseExact($To, "yyyy-MM-dd", $null)
if ($end -lt $start) {
  throw "To ($To) must be >= From ($From)"
}

Write-Host "Replay push FCM - rango Bogota: $From .. $To" -ForegroundColor Cyan

$summary = @()
$totalEnqueued = 0
$totalSent = 0

for ($d = $start; $d -le $end; $d = $d.AddDays(1)) {
  $day = $d.ToString("yyyy-MM-dd")
  Write-Host "`n--- $day ---" -ForegroundColor Yellow
  $body = @{ date = $day } | ConvertTo-Json
  $resp = Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body
  $resp | ConvertTo-Json -Depth 6
  $enq = if ($null -ne $resp.enqueued) { [int]$resp.enqueued } else { 0 }
  $sent = if ($null -ne $resp.sent_total) { [int]$resp.sent_total } else { 0 }
  $totalEnqueued += $enq
  $totalSent += $sent
  $prodCount = if ($null -ne $resp.products) { [int]$resp.products } else { 0 }
  $summary += [pscustomobject]@{
    date     = $day
    products = $prodCount
    enqueued = $enq
    sent     = $sent
  }
}

Write-Host "`n=== RESUMEN ===" -ForegroundColor Green
$summary | Format-Table -AutoSize
Write-Host "Total enqueued: $totalEnqueued | Total sent (reportado): $totalSent" -ForegroundColor Green
