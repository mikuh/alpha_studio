@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows-msi.ps1" -OpenOutput %*
set "ALPHA_BUILD_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%ALPHA_BUILD_EXIT_CODE%"=="0" (
  echo MSI build failed. Review the error above.
) else (
  echo MSI build finished. The output folder has been opened in Explorer.
)

pause
exit /b %ALPHA_BUILD_EXIT_CODE%
