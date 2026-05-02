# 在项目根目录双击运行，或在 PowerShell 中: .\run.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "未找到 .venv，正在自动创建…" -ForegroundColor Yellow
    python -m venv .venv
}

Write-Host "正在安装 / 更新依赖…" -ForegroundColor Yellow
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

Write-Host ""
Write-Host "Find Yourself 正在启动…" -ForegroundColor Green
Write-Host "  在浏览器打开:  http://127.0.0.1:8000/" -ForegroundColor White
Write-Host "  不要双击打开 static\index.html（那样无法加载脚本）。" -ForegroundColor DarkGray
Write-Host "  按 Ctrl+C 停止服务。" -ForegroundColor DarkGray
Write-Host ""

& ".\.venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
