#include <stdint.h>
#include <stdlib.h>
#define PCRE2_CODE_UNIT_WIDTH 8
#include "pcre2.h"

static int last_error;
static PCRE2_SIZE last_offset;
static unsigned char error_text[256];

uintptr_t egg_pcre_compile(const unsigned char *pattern, uint32_t length, uint32_t options, uint32_t extra) {
    pcre2_compile_context *context = pcre2_compile_context_create(NULL);
    if (!context) { last_error = PCRE2_ERROR_NOMEMORY; return 0; }
    pcre2_set_compile_extra_options(context, extra);
    pcre2_set_max_pattern_length(context, 4 * 1024 * 1024);
    pcre2_code *code = pcre2_compile(pattern, length, options, &last_error, &last_offset, context);
    pcre2_compile_context_free(context);
    return (uintptr_t)code;
}

void egg_pcre_free(uintptr_t code) { pcre2_code_free((pcre2_code *)code); }

int egg_pcre_match(uintptr_t code, const unsigned char *subject, uint32_t length) {
    pcre2_match_data *data = pcre2_match_data_create_from_pattern((pcre2_code *)code, NULL);
    pcre2_match_context *context = pcre2_match_context_create(NULL);
    if (!data || !context) {
        pcre2_match_data_free(data);
        pcre2_match_context_free(context);
        return PCRE2_ERROR_NOMEMORY;
    }
    /* PHP defaults, plus an explicit heap bound within the Wasm memory cap. */
    pcre2_set_match_limit(context, 1000000);
    pcre2_set_depth_limit(context, 100000);
    pcre2_set_heap_limit(context, 32768);
    int result = pcre2_match((pcre2_code *)code, subject, length, 0, 0, data, context);
    pcre2_match_context_free(context);
    pcre2_match_data_free(data);
    return result;
}

uint32_t egg_pcre_error_offset(void) { return (uint32_t)last_offset; }
uintptr_t egg_pcre_error_message(int error) {
    if (error == 0) error = last_error;
    int count = pcre2_get_error_message(error, error_text, sizeof(error_text));
    if (count < 0) error_text[0] = 0;
    return (uintptr_t)error_text;
}
