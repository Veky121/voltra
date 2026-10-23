#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "../../internal/panel/game_library/scripts/nzp-vril-console.h"
#include "../../internal/panel/game_library/scripts/nzp-vril-client-ports.h"
static int attempts, expected_port;
static int fake_open_socket(int port) { ++attempts; return port == expected_port ? 100 : -1; }

int main(void)
{
    int descriptors[2];
    char oversized[5001];
    assert(pipe(descriptors) == 0);
    assert(dup2(descriptors[0], STDIN_FILENO) == STDIN_FILENO);
    close(descriptors[0]);
    assert(Voltra_ConsoleInput() == NULL);
    assert(write(descriptors[1], "partial", 7) == 7);
    assert(Voltra_ConsoleInput() == NULL);
    assert(write(descriptors[1], " command\r\nsecond\n", 17) == 17);
    assert(strcmp(Voltra_ConsoleInput(), "partial command\n") == 0);
    assert(strcmp(Voltra_ConsoleInput(), "second\n") == 0);
    assert(Voltra_ConsoleInput() == NULL);
    memset(oversized, 'x', 5000); oversized[5000] = '\n';
    assert(write(descriptors[1], oversized, sizeof(oversized)) == sizeof(oversized));
    assert(Voltra_ConsoleInput() == NULL);
    assert(Voltra_ConsoleInput() == NULL);
    assert(write(descriptors[1], "bad\0command\nvalid\n", 18) == 18);
    assert(strcmp(Voltra_ConsoleInput(), "valid\n") == 0);
    close(descriptors[1]);
    assert(Voltra_ConsoleInput() == NULL);
    signal(SIGTERM, Voltra_Terminate);
    raise(SIGTERM);
    assert(voltra_termination_requested == 1);
    expected_port = 28012;
    assert(Voltra_OpenClientSocket(28010, 4, fake_open_socket) == 100);
    assert(attempts == 2);
    attempts = 0; expected_port = 0;
    assert(Voltra_OpenClientSocket(28010, 4, fake_open_socket) == -1);
    assert(attempts == 4);
    attempts = 0;
    assert(Voltra_OpenClientSocket(65532, 4, fake_open_socket) == -1);
    assert(Voltra_OpenClientSocket(28010, 17, fake_open_socket) == -1);
    assert(attempts == 0);
    assert(Voltra_LearnInitialPeer(1,1,1,0,0,9,0x00100009u,0,1));
    assert(Voltra_LearnInitialPeer(1,1,1,0,0,9,0x00090009u,0,1));
    assert(!Voltra_LearnInitialPeer(0,1,1,0,0,9,0x00100009u,0,1));
    assert(!Voltra_LearnInitialPeer(1,-1,1,0,0,9,0x00100009u,0,1));
    assert(!Voltra_LearnInitialPeer(1,1,11,0,0,9,0x00100009u,0,1));
    assert(!Voltra_LearnInitialPeer(1,1,1,1,0,9,0x00100009u,0,1));
    assert(!Voltra_LearnInitialPeer(1,1,1,0,1,9,0x00100009u,0,1));
    assert(!Voltra_LearnInitialPeer(1,1,1,0,0,8,0x00100009u,0,1));
    assert(!Voltra_LearnInitialPeer(1,1,1,0,0,9,0x0010000au,0,1));
    assert(!Voltra_LearnInitialPeer(1,1,1,0,0,9,0x00100009u,1,1));
    assert(!Voltra_LearnInitialPeer(1,1,1,0,0,9,0x00100009u,0,2));
    assert(Voltra_SameConnection(0));
    assert(!Voltra_SameConnection(1)); /* Separate same-IP peers coexist. */
    assert(!Voltra_SameConnection(-1));
    puts("Dedicated console partial/CRLF/multiline/overflow/NUL/EOF/signal tests passed");
    return 0;
}
