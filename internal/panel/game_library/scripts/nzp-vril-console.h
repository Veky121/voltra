/* MIT. Bounded Linux dedicated-console adapter for NZ:P Vril. */
#ifndef VOLTRA_VRIL_CONSOLE_H
#define VOLTRA_VRIL_CONSOLE_H
#include <errno.h>
#include <signal.h>
#include <stddef.h>
#include <sys/select.h>
#include <unistd.h>

static volatile sig_atomic_t voltra_termination_requested;
static void Voltra_Terminate(int number) { (void)number; voltra_termination_requested = 1; }

static char *Voltra_ConsoleInput(void)
{
    static char line[4096];
    static size_t used;
    static int dropping;
    unsigned int budget;
    for (budget = 0; budget < sizeof(line); ++budget) {
        fd_set readable;
        struct timeval timeout = {0, 0};
        unsigned char byte;
        FD_ZERO(&readable);
        FD_SET(STDIN_FILENO, &readable);
        if (select(STDIN_FILENO + 1, &readable, NULL, NULL, &timeout) <= 0)
            return NULL;
        if (read(STDIN_FILENO, &byte, 1) != 1)
            return NULL;
        if (byte == '\r' || byte == '\n') {
            if (dropping) { dropping = 0; used = 0; continue; }
            if (!used) continue;
            line[used++] = '\n';
            line[used] = 0;
            used = 0;
            return line;
        }
        if (!byte || used >= sizeof(line) - 2) { dropping = 1; used = 0; }
        else if (!dropping) line[used++] = (char)byte;
    }
    return NULL;
}
#endif
