$result = gcloud auth print-identity-token 2>&1
Write-Host "RESULT:"
Write-Host $result