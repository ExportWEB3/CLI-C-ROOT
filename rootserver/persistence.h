#ifndef PERSISTENCE_H
#define PERSISTENCE_H

#include <windows.h>

/**
 * Adds a program to Windows startup via registry.
 * Used for legitimate system utilities that need to run on boot.
 * 
 * @param name Display name for the startup entry
 * @param path Full path to the executable
 * @return BOOL TRUE if successful, FALSE otherwise
 */
BOOL AddToStartup(const char* name, const char* path);

/**
 * Removes a program from Windows startup registry.
 * Cleanup function for uninstalling system utilities.
 * 
 * @param name Display name of the startup entry to remove
 * @return BOOL TRUE if successful, FALSE otherwise
 */
BOOL RemoveFromStartup(const char* name);

#endif // PERSISTENCE_H