/* Timelib bridge; date formatter body is extracted verbatim from PHP 8.5.4.
 * See TIMELIB-LICENSE (MIT) and PHP-LICENSE for upstream source licenses. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdarg.h>
#include "timelib.h"
#include "timelib_private.h"

#define zend_string char
#define zend_long int64_t
#define ZEND_LONG_FMT "%lld"
#define ZEND_LONG_FMT_SPEC "lld"
#define ZSTR_EMPTY_ALLOC() strdup("")
#define ZEND_FALLTHROUGH __attribute__((fallthrough))
#define php_date_llabs llabs
typedef struct { char *s; size_t len, cap; } smart_str;
static void smart_str_appendl(smart_str *s, const char *bytes, size_t len) {
    if (s->len + len + 1 > 8*1024*1024) abort();
    if (s->len + len + 1 > s->cap) {
        s->cap = (s->len + len + 1)*2;
        s->s = realloc(s->s, s->cap);
        if (!s->s) abort();
    }
    memcpy(s->s+s->len, bytes, len); s->len += len;
}
static void smart_str_0(smart_str *s) { smart_str_appendl(s, "", 1); }
static int slprintf(char *buf, size_t size, const char *fmt, ...) {
    va_list args; va_start(args, fmt); int n=vsnprintf(buf,size,fmt,args); va_end(args);
    return n < 0 ? 0 : (n >= size ? size-1 : n);
}
#include "php_format.inc"

/* Parsed timezone pointers are shared by timelib structures, so own them here
 * and release all of them after each call. This avoids an unbounded tz cache. */
static timelib_tzinfo *zones[64];
static int zones_count;
static timelib_tzinfo *get_zone(const char *name,const timelib_tzdb *db,int *error) {
    for(int i=0;i<zones_count;i++) if(!strcmp(zones[i]->name,name)) { *error=0; return zones[i]; }
    if(zones_count==64) { *error=1; return NULL; }
    timelib_tzinfo *zone=timelib_parse_tzfile(name,db,error);
    if(zone) zones[zones_count++]=zone;
    return zone;
}
static int64_t result_seconds;
static int result_micros, result_calendar;
static char *result_formatted;
int64_t egg_date_seconds(void) { return result_seconds; }
int egg_date_micros(void) { return result_micros; }
int egg_date_valid_calendar(void) { return result_calendar; }
const char *egg_date_formatted(void) { return result_formatted; }
int egg_date_parse(const char *value, uint32_t length, const char *format, const char *zone, int64_t now_seconds, int now_micros) {
    if(result_formatted) { free(result_formatted); result_formatted=NULL; }
    result_seconds=0; result_micros=0; result_calendar=0;
    if(length > 4*1024*1024 || (format && strlen(format)>65536) || strlen(zone)>256) return -1;
    timelib_error_container *errors=NULL;
    const timelib_tzdb *db=timelib_builtin_db();
    timelib_time *parsed=NULL,*base=NULL;
    int status=0, error=0;
    timelib_tzinfo *tz=get_zone(zone,db,&error);
    if(!tz) goto finish;
    if(format) {
        char *reset_format=malloc(strlen(format)+2);
        if(!reset_format) goto finish;
        reset_format[0]='!'; strcpy(reset_format+1,format);
        parsed=timelib_parse_from_format(reset_format,value,length,&errors,db,get_zone);
        free(reset_format);
    }
    else parsed=timelib_strtotime(length ? value : "now",length ? length : 3,&errors,db,get_zone);
    if(!parsed || (errors && errors->error_count)) goto finish;
    result_calendar=parsed->y>=1 && parsed->y<=32767 && parsed->m!=TIMELIB_UNSET && parsed->d!=TIMELIB_UNSET && timelib_valid_date(parsed->y,parsed->m,parsed->d);
    base=timelib_time_ctor(); base->zone_type=TIMELIB_ZONETYPE_ID;
    base->tz_info=tz; timelib_unixtime2local(base,now_seconds); base->us=now_micros;
    timelib_fill_holes(parsed,base,TIMELIB_NO_CLONE | (format ? TIMELIB_OVERRIDE_TIME : 0));
    timelib_update_ts(parsed,tz); timelib_update_from_sse(parsed);
    result_seconds=parsed->sse; result_micros=parsed->us;
    if(format) result_formatted=date_format(format,strlen(format),parsed,parsed->is_localtime);
    status=1;
finish:
    if(errors) timelib_error_container_dtor(errors);
    if(parsed) timelib_time_dtor(parsed);
    if(base) timelib_time_dtor(base);
    for(int i=0;i<zones_count;i++) timelib_tzinfo_dtor(zones[i]);
    zones_count=0;
    return status;
}
