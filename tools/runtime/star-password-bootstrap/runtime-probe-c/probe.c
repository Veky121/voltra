/* SPDX-License-Identifier: MIT
 * Fixed Win32 import checker. No CRT, game, UE4SS, configuration or user paths.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

typedef struct {
    const char *name;
    WORD ordinal;
} ProbeExport;

typedef struct {
    const char *name;
    const WCHAR *request;
    const ProbeExport *exports;
    unsigned int count;
} ProbeLibrary;

#include "imports.h"

static char line[512];
static WCHAR wide_line[512];

static BOOL append(unsigned int *position, const char *value)
{
    while (*value) {
        if (*position >= sizeof(line) - 2) return FALSE;
        line[(*position)++] = *value++;
    }
    return TRUE;
}

static void report(const char *prefix, const char *library, const char *symbol)
{
    unsigned int position = 0, i;
    DWORD written;
    HANDLE output;
    if (!append(&position, prefix) || !append(&position, library))
        ExitProcess(2);
    if (*library && *symbol && !append(&position, ":")) ExitProcess(2);
    if (!append(&position, symbol)) ExitProcess(2);
    line[position++] = '\n';
    line[position] = 0;
    for (i = 0; i <= position; ++i) wide_line[i] = (WCHAR)(unsigned char)line[i];
    output = GetStdHandle(STD_OUTPUT_HANDLE);
    if (output != NULL && output != INVALID_HANDLE_VALUE)
        WriteFile(output, line, position, &written, NULL);
    OutputDebugStringW(wide_line);
}

/* Accept only the OS-supplied executable token. Never use it as a path. */
static BOOL no_extra_arguments(const WCHAR *text)
{
    unsigned int count = 0, token = 0;
    if (text == NULL) return FALSE;
    while (*text == L' ' || *text == L'\t') { if (++count > 32767) return FALSE; ++text; }
    if (*text == L'"') {
        ++text; ++count;
        while (*text && *text != L'"') {
            if (++count > 32767) return FALSE;
            ++token; ++text;
        }
        if (*text != L'"' || token == 0) return FALSE;
        if (++count > 32767) return FALSE;
        ++text;
    } else {
        while (*text && *text != L' ' && *text != L'\t') {
            if (*text == L'"' || ++count > 32767) return FALSE;
            ++token; ++text;
        }
        if (token == 0) return FALSE;
    }
    while (*text == L' ' || *text == L'\t') { if (++count > 32767) return FALSE; ++text; }
    return *text == 0;
}

void WINAPI probe_entry(void)
{
    unsigned int library_index, export_index;
    BOOL failed = FALSE;
    if (!no_extra_arguments(GetCommandLineW())) ExitProcess(2);
    report("VOLTRA_STAR_C_PROBE_MAIN_ENTERED", "", "");
    for (library_index = 0; library_index < PROBE_LIBRARY_COUNT; ++library_index) {
        const ProbeLibrary *library = &probe_libraries[library_index];
        HMODULE module = LoadLibraryExW(library->request, NULL, LOAD_LIBRARY_SEARCH_SYSTEM32);
        if (module == NULL) {
            report("MISSING_RUNTIME_LIBRARY ", library->name, "");
            failed = TRUE;
            continue;
        }
        for (export_index = 0; export_index < library->count; ++export_index) {
            const ProbeExport *symbol = &library->exports[export_index];
            LPCSTR request = symbol->ordinal ? (LPCSTR)(ULONG_PTR)symbol->ordinal : symbol->name;
            if (GetProcAddress(module, request) == NULL) {
                report("MISSING_RUNTIME_EXPORT ", library->name, symbol->name);
                failed = TRUE;
            }
        }
        FreeLibrary(module);
    }
    if (failed) ExitProcess(1);
    report("VOLTRA_STAR_C_RUNTIME_IMPORTS_READY", "", "");
    ExitProcess(0);
}
