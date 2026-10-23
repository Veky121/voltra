/* Minimal compile-only Zend compatibility. Only libmbfl decoding/checking
 * functions remain reachable in encoding.wasm; no interpreter is linked. */
#ifndef EGG_ZEND_H
#define EGG_ZEND_H
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>
#include <limits.h>
typedef struct {size_t len; size_t h; unsigned int flags; char val[1];} zend_string;
#define ZSTR_VAL(s) ((s)->val)
#define ZSTR_LEN(s) ((s)->len)
#define ZSTR_H(s) ((s)->h)
#define _ZSTR_STRUCT_SIZE(n) (sizeof(zend_string)+(n))
#define GC_SET_REFCOUNT(s,n) ((void)0)
#define GC_TYPE_INFO(s) ((s)->flags)
#define GC_STRING 0
#define GC_ADD_FLAGS(s,n) ((void)0)
#define IS_STR_VALID_UTF8 0
#define ZEND_ASSERT assert
#define EMPTY_SWITCH_DEFAULT_CASE() default: __builtin_unreachable()
#define ZEND_FALLTHROUGH __attribute__((fallthrough))
#define ZEND_ATTRIBUTE_UNUSED __attribute__((unused))
#define ZEND_NO_SANITIZE_ADDRESS
#define ZEND_NONSTRING
#define zend_always_inline inline __attribute__((always_inline))
#define emalloc malloc
#define erealloc realloc
#define efree free
#define MIN(a,b) ((a)<(b)?(a):(b))
#define MAX(a,b) ((a)>(b)?(a):(b))
#define zend_safe_address_guarded(n,m,l) ((n)*(m)+(l))
static inline unsigned int zend_ulong_ntz(unsigned long x) {return __builtin_ctzl(x);}
extern zend_string *zend_empty_string;
static inline zend_string *zend_string_init_fast(const char *s,size_t n) {zend_string *r=malloc(_ZSTR_STRUCT_SIZE(n)); r->len=n; memcpy(r->val,s,n);r->val[n]=0;return r;}
#endif
