# Aplica migración tope diario push por dispositivo

$sql = Join-Path $PSScriptRoot '..\supabase\migrations\20260710140000_fcm_token_daily_push_cap.sql'
Get-Content $sql -Raw | Set-Clipboard
Write-Host "SQL copiado. Ejecuta en: https://supabase.com/dashboard/project/niilaxdeetuzutycvdkz/sql/new"
Write-Host $sql
