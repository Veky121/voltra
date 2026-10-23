#include "mbfl_encoding.h"
#include <strings.h>
/* This is php_mb_check_encoding from PHP 8.5.4 mbstring.c. */
int egg_encoding_check(const char *name, const char *input, size_t length) {
    const mbfl_encoding **list=mbfl_get_supported_encodings();
    const mbfl_encoding *encoding=NULL;
    for(size_t i=0;list[i];i++) {
        if(!strcasecmp(name,list[i]->name)) {encoding=list[i];break;}
    }
    if(!encoding) return -1;
    uint32_t wchar_buf[128];
    unsigned char *in=(unsigned char*)input;
    unsigned int state=0;
    if(encoding->check) return encoding->check(in,length);
    size_t out_len=encoding->to_wchar(&in,&length,wchar_buf,8,&state);
    for(unsigned int i=0;i<out_len;i++) if(wchar_buf[i]==MBFL_BAD_INPUT) return 0;
    while(length) {
        out_len=encoding->to_wchar(&in,&length,wchar_buf,128,&state);
        for(unsigned int i=0;i<out_len;i++) if(wchar_buf[i]==MBFL_BAD_INPUT) return 0;
    }
    return 1;
}
