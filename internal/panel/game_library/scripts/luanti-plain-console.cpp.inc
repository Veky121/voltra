// SPDX-License-Identifier: LGPL-2.1-or-later
// Optional line console for Wings. The original ncurses mode remains unchanged.
const char *plain_console = std::getenv("VOLTRA_LUANTI_PLAIN_CONSOLE");
if (plain_console && std::string(plain_console) == "1") {
    struct RestoreTerminal {
        termios original{};
        bool changed = false;
        RestoreTerminal() {
            if (tcgetattr(STDIN_FILENO, &original) == 0) {
                termios configured = original;
                configured.c_lflag &= ~(ECHO | ECHONL);
                changed = tcsetattr(STDIN_FILENO, TCSANOW, &configured) == 0;
            }
        }
        ~RestoreTerminal() {
            if (changed)
                tcsetattr(STDIN_FILENO, TCSANOW, &original);
        }
    } terminal;
    m_chat_interface->command_queue.push_back(new ChatEventNick(CET_NICK_ADD, m_nick));
    std::string input;
    bool readable = true;
    while (!stopRequested()) {
        fd_set descriptors;
        FD_ZERO(&descriptors);
        if (readable)
            FD_SET(STDIN_FILENO, &descriptors);
        timeval timeout{0, 100000};
        int available = select(readable ? STDIN_FILENO + 1 : 0,
                &descriptors, nullptr, nullptr, &timeout);
        if (available > 0 && readable && FD_ISSET(STDIN_FILENO, &descriptors)) {
            char chunk[1024];
            ssize_t count = read(STDIN_FILENO, chunk, sizeof(chunk));
            if (count == 0) {
                readable = false;
            } else if (count > 0) {
                input.append(chunk, static_cast<size_t>(count));
                size_t newline;
                while ((newline = input.find('\n')) != std::string::npos) {
                    std::string command = input.substr(0, newline);
                    input.erase(0, newline + 1);
                    if (!command.empty() && command.back() == '\r')
                        command.pop_back();
                    if (!command.empty())
                        m_chat_interface->command_queue.push_back(
                                new ChatEventChat(m_nick, utf8_to_wide(command)));
                }
                if (input.size() > 65536) {
                    input.clear();
                    std::cout << "[Console] Incomplete input exceeded 64 KiB; discarded." << std::endl;
                }
            }
        }
        while (!m_chat_interface->outgoing_queue.empty()) {
            ChatEvent *event = m_chat_interface->outgoing_queue.pop_frontNoEx();
            if (!event)
                continue;
            switch (event->type) {
                case CET_CHAT: {
                    auto *message = static_cast<ChatEventChat *>(event);
                    std::cout << "[Console] " << wide_to_utf8(message->evt_msg) << std::endl;
                    delete message;
                    break;
                }
                case CET_NICK_ADD:
                case CET_NICK_REMOVE:
                    delete static_cast<ChatEventNick *>(event);
                    break;
                case CET_TIME_INFO:
                    delete static_cast<ChatEventTimeInfo *>(event);
                    break;
            }
        }
    }
    if (m_kill_requested)
        *m_kill_requested = true;
    return nullptr;
}
