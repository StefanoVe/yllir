@rem yllir-shortcut v1
@echo off
rem Opens the Yllir master screen for the campaign folder this file is in.
rem Written by Yllir; refreshed by the framework when it changes.
chcp 65001 >nul
set "HERE=%~dp0"
set "HERE=%HERE:~0,-1%"
set "FW="
if exist "%USERPROFILE%\.yllir\framework-path" set /p FW=<"%USERPROFILE%\.yllir\framework-path"
if not exist "%FW%\scripts\launcher\start.ps1" set "FW={{FRAMEWORK_DEFAULT}}"
if not exist "%FW%\scripts\launcher\start.ps1" (
  echo {{NOT_FOUND}}
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%FW%\scripts\launcher\start.ps1" "%HERE%" --lang {{LANG}}
if errorlevel 1 pause
