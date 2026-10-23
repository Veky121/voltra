# SPDX-License-Identifier: MIT
"""Apply the optional console adapter only to the reviewed source layout."""
import sys
from pathlib import Path


def patch(source, adapter):
    include = '#include <inttypes.h>\n'
    anchor = 'void *TerminalChatConsole::run()\n{\n\tBEGIN_DEBUG_EXCEPTION_HANDLER\n'
    if source.count(include) != 1 or source.count(anchor) != 1 or 'VOLTRA_LUANTI_PLAIN_CONSOLE' in source:
        raise ValueError('The Luanti console source does not match the reviewed layout')
    source = source.replace(include, include + '#include <cstdlib>\n#include <sys/select.h>\n#include <termios.h>\n#include <unistd.h>\n')
    return source.replace(anchor, anchor + adapter + '\n')


if __name__ == '__main__':
    source, adapter = map(Path, sys.argv[1:])
    source.write_text(patch(source.read_text(encoding='utf-8'), adapter.read_text(encoding='utf-8')), encoding='utf-8')
