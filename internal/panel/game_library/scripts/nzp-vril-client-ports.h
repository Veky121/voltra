/* MIT. Keep NetQuake client sockets inside allocated UDP ports. */
#ifndef VOLTRA_VRIL_CLIENT_PORTS_H
#define VOLTRA_VRIL_CLIENT_PORTS_H
/* Learn a destination-specific NAT source port only from the first exact NOP.
 * AddrCompare: 0 exact, 1 same IP/different port, -1 different IP. */
static int Voltra_LearnInitialPeer(int dedicated, int comparison, double age,
    unsigned received, unsigned unreliable_received, int size,
    unsigned header, unsigned sequence, unsigned first_byte)
{
    return dedicated && comparison == 1 && age >= 0 && age <= 10 &&
        received == 0 && unreliable_received == 0 && size == 9 &&
        (header == 0x00100009u || header == 0x00090009u) &&
        sequence == 0 && first_byte == 1;
}
static int Voltra_SameConnection(int comparison) { return comparison == 0; }
static int Voltra_OpenClientSocket(int primary, int count, int (*open_socket)(int))
{
    int port, socket;
    if (count < 1 || count > 16 || primary < 1 || primary > 65535 - count) return -1;
    for (port = primary + 1; port <= primary + count; ++port) {
        socket = open_socket(port);
        if (socket != -1) return socket;
    }
    return -1;
}
#endif
