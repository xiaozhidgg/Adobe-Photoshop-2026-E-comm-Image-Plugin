@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 电商图片制作插件 · 一键卸载
cd /d "%~dp0"
set "EXTRA="
if /I "%~1"=="dry" set "EXTRA=-DryRun"
echo.
echo =====================================================================
echo  电商图片制作 · Photoshop 2026 UXP 插件   一键卸载
echo =====================================================================
if defined EXTRA echo  干跑模式：只报告要做什么，不写任何文件
echo.
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
echo [OK]   Photoshop 未在运行，开始卸载。
:after_ps
echo.
%PSEXE% -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall %EXTRA%
set "RC=%ERRORLEVEL%"
echo.
set "DATA=%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\External\com.ecom.psimage"
if defined EXTRA goto skip_purge
if exist "%DATA%" (
  echo 另外检测到插件数据（面板设置 + 调试日志）：
  echo   %DATA%
  set "PURGE="
  set /p "PURGE=是否一并删除？删除后所有面板设置会丢失 (Y/N)： "
  if /I "!PURGE!"=="Y" (
    rmdir /s /q "%DATA%"
    if exist "%DATA%" ( echo [FAIL] 删除失败，请手动删除上面的目录。 ) else ( echo [OK]   已删除插件数据。 )
  ) else (
    echo [SKIP] 保留插件数据（下次安装仍是现在的设置）。
  )
) else (
  echo [SKIP] 未发现插件数据目录，无需清理。
)
:skip_purge
echo.
echo =====================================================================
echo  卸载完成（已安装目录被改名为 插件id.bak-时间戳，保留备份不直接删除）。
echo  若要彻底停用，可在 PS 里：编辑 ^> 首选项 ^> 增效工具 ^> 取消勾选「启用开发人员模式」。
echo =====================================================================
echo.
pause
endlocal
exit /b %RC%
