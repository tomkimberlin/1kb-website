/* Compare OpenSSL's Brotli output with the unmodified encoder and round-trip it. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/comp.h>
#include <brotli/encode.h>
#include <brotli/decode.h>

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
    puts("Certificate compression checks passed");
    return 0;
}
