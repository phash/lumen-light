@echo off
rem Windows-Check Spike N0 (S4): Testbinaries + lumen-bench auf DX12 (in der VM: WARP).
rem Laeuft beim ersten Boot der tb-win-Kopie. Share = \\host.lan\Data (= .win-test\share).
rem install-result.txt wird erst ganz am Ende geschrieben (tb-win wartet darauf).
rem Ein Lauf ohne Testbinaries oder mit Kopierfehler gilt als FAILED=1.
setlocal EnableDelayedExpansion

set SHARE=\\host.lan\Data
set WORK=C:\lumen-test
set LOG=%WORK%\result.log
set FAILED=0

if exist %WORK% rmdir /s /q %WORK%
mkdir %WORK%
echo === lumen Windows-Check %DATE% %TIME% > %LOG%
ver >> %LOG%

rem Lokal kopieren: Netzpfad ist langsam und manche Tests oeffnen Dateien mehrfach.
rem robocopy: Exit-Code ab 8 = Fehler, 0 bis 7 = Erfolg.
robocopy %SHARE%\bin %WORK%\bin /e /njh /njs /nfl /ndl >nul
set RC=!ERRORLEVEL!
echo robocopy bin: Exit !RC! >> %LOG%
if !RC! GEQ 8 (
    echo FEHLER: robocopy bin fehlgeschlagen >> %LOG%
    set FAILED=1
)
robocopy %SHARE%\repo %WORK%\repo /e /njh /njs /nfl /ndl >nul
set RC=!ERRORLEVEL!
echo robocopy repo: Exit !RC! >> %LOG%
if !RC! GEQ 8 (
    echo FEHLER: robocopy repo fehlgeschlagen >> %LOG%
    set FAILED=1
)

set LUMEN_REPO_ROOT=%WORK%\repo
rem Nur DX12 zulassen, damit das Ergebnis wirklich fuer DX12 gilt.
set WGPU_BACKEND=dx12
set RUST_BACKTRACE=1

echo LUMEN_REPO_ROOT=%LUMEN_REPO_ROOT% WGPU_BACKEND=%WGPU_BACKEND% >> %LOG%
echo --- Grafikadapter WMI >> %LOG%
powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + ' / ' + $_.DriverVersion }" >> %LOG% 2>&1
echo --- Binaries >> %LOG%
dir /b %WORK%\bin >> %LOG% 2>&1
echo --- RAW-Fixtures >> %LOG%
dir /b %WORK%\repo\tests-fixtures\raw-samples >> %LOG% 2>&1
echo --- Golden-Fixtures >> %LOG%
dir /b /ad %WORK%\repo\tests-fixtures\goldens >> %LOG% 2>&1

set COUNT=0
for %%F in (%WORK%\bin\test_*.exe) do (
    set /a COUNT+=1
    echo. >> %LOG%
    echo === %%~nF >> %LOG%
    "%%F" --nocapture --test-threads=1 >> %LOG% 2>&1
    set RC=!ERRORLEVEL!
    echo EXIT %%~nF !RC! >> %LOG%
    if not "!RC!"=="0" set FAILED=1
)
echo. >> %LOG%
echo Testbinaries ausgefuehrt: !COUNT! >> %LOG%
if !COUNT! EQU 0 (
    echo FEHLER: keine Testbinaries gefunden, share\bin leer? >> %LOG%
    set FAILED=1
)

echo. >> %LOG%
echo === lumen-bench >> %LOG%
rem pushd setzt ERRORLEVEL bei Erfolg nicht zurueck, daher vorher pruefen.
if not exist %WORK%\repo\tests-fixtures\raw-samples\ (
    echo FEHLER: raw-samples fehlt, lumen-bench uebersprungen >> %LOG%
    set FAILED=1
) else (
    pushd %WORK%\repo\tests-fixtures\raw-samples
    %WORK%\bin\lumen-bench.exe --runs 3 --out %WORK%\bench-windows.json Nikon_D7100.NEF Sony_A7M3.ARW >> %LOG% 2>&1
    set RC=!ERRORLEVEL!
    popd
    echo EXIT lumen-bench !RC! >> %LOG%
    if not "!RC!"=="0" set FAILED=1
)

echo. >> %LOG%
echo === bench-windows.json >> %LOG%
if exist %WORK%\bench-windows.json type %WORK%\bench-windows.json >> %LOG%

echo. >> %LOG%
echo GESAMT FAILED=!FAILED! >> %LOG%

if exist %WORK%\bench-windows.json copy /y %WORK%\bench-windows.json %SHARE%\bench-windows.json >nul
copy /y %LOG% %SHARE%\install-result.txt >nul
endlocal
