/* MIT. Deliver input to the exact private Contagion Windows console. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdlib.h>
#include <wchar.h>

int main(int argc, char **argv)
{
    DWORD pid, length=1024, bytes=0, count=0, used=0;
    WCHAR image[1024], text[8193];
    char input[8195], *end;
    unsigned long long parsed;
    HANDLE process, console;
    int size, i;
    INPUT_RECORD records[16386];
    if(argc!=2 || !argv[1][0]) return 10;
    for(i=0;argv[1][i];i++) if(argv[1][i]<'0'||argv[1][i]>'9'||i>=10) return 11;
    parsed=strtoull(argv[1],&end,10);
    if(*end || !parsed || parsed>0xffffffffULL) return 11;
    pid=(DWORD)parsed;
    process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);
    if(!process) return 12;
    if(!QueryFullProcessImageNameW(process,0,image,&length)) { CloseHandle(process); return 13; }
    CloseHandle(process);
    if(CompareStringOrdinal(image,-1,L"Z:\\home\\container\\contagionds.exe",-1,TRUE)!=CSTR_EQUAL) return 14;
    for(;;) {
        if(used>=sizeof(input)) return 15;
        if(!ReadFile(GetStdHandle(STD_INPUT_HANDLE),input+used,sizeof(input)-used,&bytes,NULL)) {
            if(GetLastError()!=ERROR_BROKEN_PIPE) return 15;
            break;
        }
        if(!bytes) break;
        used+=bytes;
    }
    bytes=used;
    if(!bytes) return 15;
    if(input[bytes-1]=='\n') bytes--;
    if(bytes && input[bytes-1]=='\r') bytes--;
    if(!bytes || bytes>8192) return 15;
    for(i=0;i<(int)bytes;i++) if(input[i]=='\r'||input[i]=='\n'||!input[i]) return 16;
    size=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,input,bytes,text,8192);
    if(size<=0) return 17;
    FreeConsole();
    if(!AttachConsole(pid)) return 18;
    console=CreateFileW(L"CONIN$",GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,OPEN_EXISTING,0,NULL);
    if(console==INVALID_HANDLE_VALUE) { FreeConsole(); return 19; }
    ZeroMemory(records,sizeof(records));
    for(i=0;i<=size;i++) {
        INPUT_RECORD *down=records+2*i,*up=down+1;
        down->EventType=up->EventType=KEY_EVENT;
        down->Event.KeyEvent.bKeyDown=TRUE;
        down->Event.KeyEvent.wRepeatCount=up->Event.KeyEvent.wRepeatCount=1;
        down->Event.KeyEvent.wVirtualKeyCode=up->Event.KeyEvent.wVirtualKeyCode=i==size?VK_RETURN:0;
        down->Event.KeyEvent.uChar.UnicodeChar=up->Event.KeyEvent.uChar.UnicodeChar=i==size?L'\r':text[i];
    }
    if(!WriteConsoleInputW(console,records,2*(size+1),&count) || count!=(DWORD)(2*(size+1))) { CloseHandle(console); FreeConsole(); return 20; }
    CloseHandle(console);FreeConsole();return 0;
}
