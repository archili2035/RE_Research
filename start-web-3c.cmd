@echo off
setlocal
pushd "%~dp0web-3c"
if errorlevel 1 goto :failed

call npm.cmd run build
if errorlevel 1 goto :project_failed

echo Open the Local URL shown below. Keep this window open to run the preview.
call npm.cmd run preview -- --host 127.0.0.1 --port 4173
if errorlevel 1 goto :project_failed

popd
exit /b 0

:project_failed
popd
:failed
echo Web 3C could not start. See the output above.
pause
exit /b 1
