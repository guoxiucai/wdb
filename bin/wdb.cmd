@echo off
setlocal
if exist "%~dp0..\runtime\node.exe" (
  "%~dp0..\runtime\node.exe" "%~dp0..\src\cli.js" %*
) else (
  node "%~dp0..\src\cli.js" %*
)
exit /b %errorlevel%
