# 在项目根目录双击运行，或在 PowerShell 中: .\run.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".\.venv\Scripts\uvicorn.exe")) {
    Write-Host "未找到 .venv。请先在本目录执行:" -ForegroundColor Yellow
    Write-Host "  python -m venv .venv" -ForegroundColor Cyan
    Write-Host "  .\.venv\Scripts\pip.exe install -r requirements.txt" -ForegroundColor Cyan
    exit 1
}

Write-Host ""
Write-Host "Resume Matcher 正在启动…" -ForegroundColor Green
Write-Host "  在浏览器打开:  http://127.0.0.1:8000/" -ForegroundColor White
Write-Host "  不要双击打开 static\index.html（那样无法加载脚本）。" -ForegroundColor DarkGray
Write-Host "  按 Ctrl+C 停止服务。" -ForegroundColor DarkGray
Write-Host ""

& ".\.venv\Scripts\uvicorn.exe" main:app --host 0.0.0.0 --port 8000
