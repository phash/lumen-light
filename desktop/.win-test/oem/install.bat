@echo off
rem Windows-Check Spike N0 (S4): Testbinaries + lumen-bench auf DX12 (in der VM: WARP).
rem Laeuft beim ersten Boot der tb-win-Kopie. Share = \\host.lan\Data (= .win-test\share).
rem install-result.txt wird erst ganz am Ende geschrieben (tb-win wartet darauf).
setlocal EnableDelayedExpansion

set SHARE=\\host.lan\Data
set WORK=C:\lumen-test
set LOG=%WORK%\result.log

rem Lokal kopieren: Netzpfad ist langsam und manche Tests oeffnen Dateien mehrfach.
if exist %WORK% rmdir /s /q %WORK%
mkdir %WORK%
robocopy %SHARE%\bin %WORK%\bin /e /njh /njs /nfl /ndl >nul
robocopy %SHARE%\repo %WORK%\repo /e /njh /njs /nfl /ndl >nul

set LUMEN_REPO_ROOT=%WORK%\repo
rem Nur DX12 zulassen, damit das Ergebnis wirklich fuer DX12 gilt.
set WGPU_BACKEND=dx12
set RUST_BACKTRACE=1

echo === lumen Windows-Check %DATE% %TIME% > %LOG%
ver >> %LOG%
echo LUMEN_REPO_ROOT=%LUMEN_REPO_ROOT% WGPU_BACKEND=%WGPU_BACKEND% >> %LOG%
echo --- Grafikadapter (WMI) >> %LOG%
powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + ' / ' + $_.DriverVersion }" >> %LOG% 2>&1

set FAILED=0
for %%F in (%WORK%\bin\test_*.exe) do (
    echo. >> %LOG%
    echo === %%~nF >> %LOG%
    "%%F" --nocapture --test-threads=1 >> %LOG% 2>&1
    set RC=!ERRORLEVEL!
    echo EXIT %%~nF !RC! >> %LOG%
    if not "!RC!"=="0" set FAILED=1
)

echo. >> %LOG%
echo === lumen-bench >> %LOG%
pushd %WORK%\repo\tests-fixtures\raw-samples
%WORK%\bin\lumen-bench.exe --runs 3 --out %WORK%\bench-windows.json Nikon_D7100.NEF Sony_A7M3.ARW >> %LOG% 2>&1
set RC=!ERRORLEVEL!
popd
echo EXIT lumen-bench !RC! >> %LOG%
if not "!RC!"=="0" set FAILED=1

echo. >> %LOG%
echo === bench-windows.json >> %LOG%
if exist %WORK%\bench-windows.json type %WORK%\bench-windows.json >> %LOG%

echo. >> %LOG%
echo GESAMT FAILED=%FAILED% >> %LOG%

if exist %WORK%\bench-windows.json copy /y %WORK%\bench-windows.json %SHARE%\bench-windows.json >nul
copy /y %LOG% %SHARE%\install-result.txt >nul
endlocal
