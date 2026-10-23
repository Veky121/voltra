// Voltra alteration, MIT. Read dashboard stdin on the native server thread.
// Existing UDP RCON and external-console behavior remain unchanged.
class CVoltraInput
{
	char m_aLine[4096];
	unsigned m_Length;
	bool m_Open;
	bool m_Discard;
public:
	CVoltraInput() : m_Length(0), m_Open(true), m_Discard(false) {}
	void Poll(IConsole *pConsole)
	{
		if(!m_Open) return;
		pollfd Fd = {STDIN_FILENO, POLLIN, 0};
		if(poll(&Fd, 1, 0) <= 0 || !(Fd.revents & (POLLIN | POLLHUP))) return;
		char aInput[512];
		ssize_t Count = read(STDIN_FILENO, aInput, sizeof(aInput));
		if(Count == 0) { m_Open = false; return; }
		if(Count < 0) { if(errno != EINTR && errno != EAGAIN) m_Open = false; return; }
		for(ssize_t i = 0; i < Count; ++i)
		{
			if(aInput[i] == '\n')
			{
				if(!m_Discard)
				{
					if(m_Length && m_aLine[m_Length-1] == '\r') --m_Length;
					m_aLine[m_Length] = 0;
					if(m_Length) pConsole->ExecuteLine(m_aLine);
				}
				m_Length = 0;
				m_Discard = false;
			}
			else if(!aInput[i] || m_Length + 1 >= sizeof(m_aLine))
				m_Discard = true;
			else if(!m_Discard)
				m_aLine[m_Length++] = aInput[i];
		}
	}
};
