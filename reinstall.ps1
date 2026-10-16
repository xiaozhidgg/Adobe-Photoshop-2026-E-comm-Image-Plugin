# 一条命令重装插件：先确保 Photoshop 退出（正常退出优先，超时再强制结束），再跑 install.ps1，最后逐文件校验装机副本。
# 用法： pwsh -File .\reinstall.ps1
# 背景：UXP 插件不热重载，且 install.ps1 会硬拒「PS 正在运行」；用户 2026-10-16 授权装机前直接关闭 PS。
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dep  = Join-Path $env:APPDATA "Adobe\UXP\Plugins\External\com.ecom.psimage"
$log  = Join-Path $env:APPDATA "Adobe\UXP\PluginsStorage\PHSP\27\External\com.ecom.psimage\PluginData\ecom-debug.log"

$proc = Get-Process -Name Photoshop -ErrorAction SilentlyContinue
if ($proc) {
  Write-Host ("Photoshop 在运行（PID " + ($proc.Id -join ',') + "）→ 请求正常退出")
  foreach ($x in $proc) { try { $x.CloseMainWindow() | Out-Null } catch { } }
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-Process -Name Photoshop -ErrorAction SilentlyContinue)) { break }
  }
  $proc = Get-Process -Name Photoshop -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host "正常退出超时 → 强制结束 Photoshop（装机前必须退出）"
    $proc | Stop-Process -Force
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Milliseconds 500
      if (-not (Get-Process -Name Photoshop -ErrorAction SilentlyContinue)) { break }
    }
  }
}
if (Get-Process -Name Photoshop -ErrorAction SilentlyContinue) { throw "Photoshop 仍未退出，装机中止" }
Write-Host "Photoshop 已退出 → 开始装机"

& (Join-Path $root "install.ps1")

$srcRoot = Join-Path $root "plugin"
$bad = 0
Get-ChildItem $srcRoot -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($srcRoot.Length + 1)
  $dst = Join-Path $dep $rel
  if (-not (Test-Path $dst)) { Write-Host ("  [缺失] " + $rel); $bad++ }
  elseif ((Get-FileHash $_.FullName -Algorithm SHA256).Hash -ne (Get-FileHash $dst -Algorithm SHA256).Hash) {
    Write-Host ("  [不一致] " + $rel); $bad++
  }
}
Write-Host ("装机副本校验：不一致/缺失 " + $bad + " 个文件")
if (Test-Path $log) { Write-Host ("日志基线 = " + (Get-Content $log).Length + " 行") }
