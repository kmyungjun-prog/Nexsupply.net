$result = curl.exe -s -w "`nHTTP_CODE:%{http_code}" "https://nexsupply-backend-866423095824.us-east1.run.app/healthz"
Write-Host $result