@echo off
cd /d "c:\Users\Administrator\Desktop\CLI C+ Root\rootserver"
SET "PATH=%~dp0rootserver\w64devkit\w64devkit\bin;%PATH%"
SET "AS_BIN=%~dp0rootserver\w64devkit\w64devkit\bin"
g++ -c data_scraper.cpp -o data_scraper.o -std=c++17 -lwininet -lole32 -lwindowscodecs -lgdi32 -B "%AS_BIN%" 2>&1
echo EXIT_CODE=%ERRORLEVEL%
