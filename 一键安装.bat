@echo off
chcp 65001 >nul
setlocal
title 电商图片制作插件 · 一键安装
cd /d "%~dp0"
set "EXTRA="
if /I "%~1"=="dry" set "EXTRA=-DryRun"
echo.
echo =====================================================================
echo  电商图片制作 · Photoshop 2026 UXP 插件   一键安装
echo =====================================================================
echo  本文件位置：%~dp0
echo  插件源目录：%~dp0plugin
if defined EXTRA echo  干跑模式：只报告要做什么，不写任何文件
echo.
if not exist "%~dp0plugin\manifest.json" (
  echo [FAIL] 找不到 "%~dp0plugin\manifest.json"
  echo        请把本文件放在插件文件夹根目录（与 plugin 子文件夹同级）后再双击。
  echo.
  pause
  exit /b 1
)
set "PSEXE=powershell"
where pwsh >nul 2>nul && set "PSEXE=pwsh"
if defined EXTRA goto after_ps
:chkps
tasklist /FI "IMAGENAME eq Photoshop.exe" 2>nul | find /I "Photoshop.exe" >nul
if not errorlevel 1 (
  echo [等待] 检测到 Photoshop 正在运行。
  echo        请完全退出 Photoshop（含后台进程）后，回到本窗口按任意键继续……
  pause >nul
  goto chkps
)
echo [OK]   Photoshop 未在运行，开始安装。
:after_ps
echo.
%PSEXE% -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %EXTRA%
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo =====================================================================
  echo  安装完成。接下来请：
  echo    1^) 打开 Photoshop 2026
  echo    2^) 编辑 ^> 首选项 ^> 增效工具 ^> 勾选「启用开发人员模式」（只需设置一次）
  echo    3^) 窗口 ^> 增效工具 ^> 电商图片制作
  echo =====================================================================
) else (
  echo [FAIL] 安装脚本返回错误码 %RC%，请把上面的输出整段发给我。
)
echo.
pause
endlocal
exit /b %RC%
