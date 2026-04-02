# 测试 API 路由

Write-Host "Testing API routes..." -ForegroundColor Yellow

# 测试 evaluations messages API
Write-Host "`n1. Testing /api/evaluations/[id]/messages..." -ForegroundColor Cyan
try {
    $response1 = Invoke-WebRequest -Uri "http://localhost:3000/api/evaluations/test-id/messages" -Method GET -Headers @{"Authorization"="Bearer test"} -UseBasicParsing -ErrorAction Stop
    Write-Host "Status: $($response1.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

# 测试 sessions children API
Write-Host "`n2. Testing /api/sessions/[id]/children..." -ForegroundColor Cyan
try {
    $response2 = Invoke-WebRequest -Uri "http://localhost:3000/api/sessions/test-id/children" -Method GET -Headers @{"Authorization"="Bearer test"} -UseBasicParsing -ErrorAction Stop
    Write-Host "Status: $($response2.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

# 测试 evaluations API
Write-Host "`n3. Testing /api/evaluations/[id]..." -ForegroundColor Cyan
try {
    $response3 = Invoke-WebRequest -Uri "http://localhost:3000/api/evaluations/test-id" -Method GET -Headers @{"Authorization"="Bearer test"} -UseBasicParsing -ErrorAction Stop
    Write-Host "Status: $($response3.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nTest completed!" -ForegroundColor Yellow
