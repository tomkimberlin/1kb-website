/* Fixed-source research harness; called by reproduce-brotli-391-20261028.py. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <brotli/decode.h>
#include <brotli/encode.h>

static int modify, tree_count, bad_tree;

/* Inserted after the stock encoder creates each data tree, before it assigns
   canonical codes. Swapping two nonzero depths preserves the tree's shape. */
void one_swap_depths(uint8_t* depth, size_t length) {
  size_t left, right;
  if (tree_count == 0 && length == 256) { left = 49; right = 119; }
  else if (tree_count == 1 && length == 704) { left = 180; right = 208; }
  else if (tree_count == 2 && length == 65) { ++tree_count; return; }
  else { bad_tree = 1; ++tree_count; return; }
  ++tree_count;
  if (depth[left] != 7 || depth[right] != 6) { bad_tree = 1; return; }
  if (modify) { uint8_t value = depth[left]; depth[left] = depth[right]; depth[right] = value; }
}

static int verify(const uint8_t* encoded, size_t size, const uint8_t* input, size_t input_size) {
  BrotliDecoderState* state = BrotliDecoderCreateInstance(NULL, NULL, NULL);
  uint8_t output[1041];
  const uint8_t* next_in = encoded;
  uint8_t* next_out = output;
  size_t available_in = size, available_out = sizeof(output), total_out = 0;
  BrotliDecoderResult result;
  if (!state) return 0;
  result = BrotliDecoderDecompressStream(state, &available_in, &next_in,
      &available_out, &next_out, &total_out);
  BrotliDecoderDestroyInstance(state);
  return result == BROTLI_DECODER_RESULT_SUCCESS && available_in == 0 &&
      total_out == input_size && memcmp(output, input, input_size) == 0;
}

int main(int argc, char** argv) {
  uint8_t input[1041], output[4096];
  const uint8_t* next_in = input;
  uint8_t* next_out = output;
  size_t input_size, available_in, available_out = sizeof(output), total_out = 0;
  FILE* file;
  BrotliEncoderState* state;
  if (argc != 3 || (strcmp(argv[2], "control") && strcmp(argv[2], "candidate"))) return 1;
  modify = strcmp(argv[2], "candidate") == 0;
  file = fopen(argv[1], "rb");
  if (!file) return 2;
  input_size = fread(input, 1, sizeof(input), file);
  if (ferror(file) || fclose(file) || input_size != 1040) return 3;
  available_in = input_size;
  state = BrotliEncoderCreateInstance(NULL, NULL, NULL);
  if (!state) return 4;
  /* These are supplied encoder options, not claims about emitted headers. */
  if (!BrotliEncoderSetParameter(state, BROTLI_PARAM_MODE, BROTLI_MODE_GENERIC) ||
      !BrotliEncoderSetParameter(state, BROTLI_PARAM_QUALITY, 11) ||
      !BrotliEncoderSetParameter(state, BROTLI_PARAM_LGWIN, 16) ||
      !BrotliEncoderSetParameter(state, BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING, 0) ||
      !BrotliEncoderSetParameter(state, BROTLI_PARAM_NPOSTFIX, 1) ||
      !BrotliEncoderSetParameter(state, BROTLI_PARAM_NDIRECT, 28) ||
      !BrotliEncoderCompressStream(state, BROTLI_OPERATION_FINISH, &available_in,
          &next_in, &available_out, &next_out, &total_out) ||
      available_in || !BrotliEncoderIsFinished(state) ||
      total_out != sizeof(output) - available_out || bad_tree || tree_count != 3) {
    BrotliEncoderDestroyInstance(state);
    return 5;
  }
  BrotliEncoderDestroyInstance(state);
  if (!verify(output, total_out, input, input_size) || !total_out ||
      verify(output, total_out - 1, input, input_size) || total_out == sizeof(output)) return 6;
  output[total_out] = 0x7f;
  if (verify(output, total_out + 1, input, input_size)) return 6;
  return fwrite(output, 1, total_out, stdout) == total_out ? 0 : 7;
}
