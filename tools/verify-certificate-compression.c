/* Compare OpenSSL's Brotli output with the unmodified encoder and round-trip it. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/comp.h>
#include <openssl/crypto.h>
#include <openssl/err.h>
#include <brotli/encode.h>
#include <brotli/decode.h>

static int fail_trial_allocation, trial_allocation_failed;

static void *test_malloc(size_t size, const char *file, int line)
{
    (void)line;
    if (fail_trial_allocation && !trial_allocation_failed && file != NULL
        && strstr(file, "c_brotli.c") != NULL) {
        trial_allocation_failed = 1;
        return NULL;
    }
    return malloc(size);
}

static void *test_realloc(void *memory, size_t size, const char *file, int line)
{
    (void)file; (void)line;
    return realloc(memory, size);
}

static void test_free(void *memory, const char *file, int line)
{
    (void)file; (void)line;
    free(memory);
}

static int check_trial_allocation_failure(unsigned char *input, size_t length,
    int preserve_error)
{
    size_t capacity = BrotliEncoderMaxCompressedSize(length);
    size_t normal_length = capacity;
    unsigned char *normal = malloc(capacity), *output = malloc(capacity);
    COMP_CTX *ctx = COMP_CTX_new(COMP_brotli_oneshot());
    unsigned long prior_error = 0;
    int result;

    if (!normal || !output || !ctx)
        return 1;
    if (!BrotliEncoderCompress(BROTLI_DEFAULT_QUALITY, BROTLI_DEFAULT_WINDOW,
            BROTLI_DEFAULT_MODE, length, input, &normal_length, normal))
        return 1;
    ERR_clear_error();
    if (preserve_error) {
        ERR_raise(ERR_LIB_USER, 123);
        prior_error = ERR_peek_last_error();
        if (!prior_error || !ERR_set_mark()) return 1;
    }
    trial_allocation_failed = 0;
    fail_trial_allocation = 1;
    result = COMP_compress_block(ctx, output, (int)capacity, input, (int)length);
    fail_trial_allocation = 0;
    if (!trial_allocation_failed || result != (int)normal_length
        || memcmp(output, normal, normal_length)) {
        fprintf(stderr, "Trial allocation failure lost the successful baseline encoding\n");
        return 1;
    }
    if (ERR_peek_last_error() != prior_error
        || (preserve_error && !ERR_pop_to_mark())
        || ERR_get_error() != prior_error || ERR_get_error() != 0) {
        fprintf(stderr, "Optional trial failure changed the caller's error queue\n");
        return 1;
    }
    result = COMP_compress_block(ctx, output, (int)capacity, input, (int)length);
    if (result <= 0 || (size_t)result > normal_length)
        return 1;
    printf("trial-allocation-failure%s: %zu default bytes preserved; error queue preserved; retry succeeded\n",
           preserve_error ? "-prior-error" : "", normal_length);
    COMP_CTX_free(ctx);
    free(output); free(normal);
    return 0;
}

static int check(unsigned char *input, size_t length, const char *name)
{
    size_t capacity = BrotliEncoderMaxCompressedSize(length);
    size_t normal_length = capacity, decoded_length = length;
    unsigned char *normal = malloc(capacity), *output = malloc(capacity + 16);
    unsigned char *decoded = malloc(length ? length : 1);
    COMP_CTX *ctx = COMP_CTX_new(COMP_brotli_oneshot());
    int result;

    if (!normal || !output || !decoded || !ctx)
        return 1;
    memset(output, 0xa5, capacity + 16);
    if (!BrotliEncoderCompress(BROTLI_DEFAULT_QUALITY, BROTLI_DEFAULT_WINDOW,
            BROTLI_DEFAULT_MODE, length, input, &normal_length, normal))
        return 1;
    result = COMP_compress_block(ctx, output, (int)capacity, input, (int)length);
    if (length == 0) {
        if (result != 0) return 1;
    } else {
        if (result <= 0 || (size_t)result > normal_length
            || BrotliDecoderDecompress(result, output, &decoded_length, decoded)
               != BROTLI_DECODER_RESULT_SUCCESS
            || decoded_length != length || memcmp(input, decoded, length))
            return 1;
    }
    for (size_t i = capacity; i < capacity + 16; i++)
        if (output[i] != 0xa5) return 1;
    if (length > 1) {
        memset(output, 0xa5, capacity + 16);
        if (COMP_compress_block(ctx, output, 1, input, (int)length) >= 0)
            return 1;
        for (size_t i = 1; i < capacity + 16; i++)
            if (output[i] != 0xa5) return 1;
    }
    printf("%s: %zu input, %zu default, %d selected\n", name, length,
           normal_length, result);
    COMP_CTX_free(ctx);
    free(decoded); free(output); free(normal);
    return 0;
}

int main(int argc, char **argv)
{
    unsigned char data[65536];
    const size_t lengths[] = {0, 1, 2, 16, 128, 1024, 2047, 2048, 2049,
                              2215, 16384, 32768, 65536};
    unsigned state = 92311;
    if (!CRYPTO_set_mem_functions(test_malloc, test_realloc, test_free))
        return 1;
    for (int pattern = 0; pattern < 3; pattern++) {
        for (size_t i = 0; i < sizeof(data); i++) {
            state = state * 1664525u + 1013904223u;
            data[i] = pattern == 0 ? 'a' : pattern == 1 ? i % 251 : state >> 24;
        }
        for (size_t i = 0; i < sizeof(lengths) / sizeof(lengths[0]); i++)
            if (check(data, lengths[i], "synthetic")) return 1;
    }
    for (int i = 1; i < argc; i++) {
        FILE *file = fopen(argv[i], "rb");
        if (!file) return 1;
        size_t length = fread(data, 1, sizeof(data), file);
        if (ferror(file) || !feof(file)) return 1;
        fclose(file);
        if (check(data, length, argv[i])) return 1;
    }
    if (check_trial_allocation_failure(data, 2048, 0)
        || check_trial_allocation_failure(data, 2048, 1)) return 1;
    puts("Certificate compression checks passed");
    return 0;
}
