@rem yllir-shortcut v1
@echo off
setlocal DisableDelayedExpansion
rem Opens the Yllir master screen for the campaign folder this file is in.
rem Written by Yllir; refreshed by the framework when it changes.
rem Keep this file CRLF and UTF-8 without BOM. Non-ASCII text is printed after chcp 65001.
rem Closing the console window ends the master screen: the launcher and the server run as
rem children of this window. The server also exits 60 s after its last browser tab closes.
rem The window stays open only when the launcher fails (pause below).
chcp 65001 >nul
set "HERE=%~dp0"
set "HERE=%HERE:~0,-1%"
set "FW="
if exist "%USERPROFILE%\.yllir\framework-path" set /p FW=<"%USERPROFILE%\.yllir\framework-path"
if "%FW%"=="" set "FW={{FRAMEWORK_DEFAULT}}"
if not exist "%FW%\scripts\launcher\start.ps1" set "FW={{FRAMEWORK_DEFAULT}}"
if not exist "%FW%\scripts\launcher\start.ps1" (
  echo {{NOT_FOUND}}
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%FW%\scripts\launcher\start.ps1" "%HERE%" --lang {{LANG}}
if errorlevel 1 pause
