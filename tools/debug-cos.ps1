# Windows 版调试脚本
Write-Host "=== 环境变量检查 ===" -ForegroundColor Green
Write-Host "SP_ASSET_BASE_URL: $env:SP_ASSET_BASE_URL"
Write-Host "SP_DATA_BASE_URL: $env:SP_DATA_BASE_URL"
Write-Host ""

Write-Host "=== 测试 runtime-config.json 接口 ===" -ForegroundColor Green
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/runtime-config.json" -Method Get
    $response | ConvertTo-Json
} catch {
    Write-Host "无法访问 runtime-config.json: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "=== 检查 Node.js 进程 ===" -ForegroundColor Green
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime
