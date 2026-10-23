# Invoke from a configured nginx source directory, after objs/Makefile.
# Reuse its compiler, production CFLAGS, include paths and generated headers.
.PHONY: verify-quic-transport
verify-quic-transport:
	$(CC) $(CFLAGS) $(QUIC_TEST_CPPFLAGS) $(ALL_INCS) -ffunction-sections -fdata-sections "$(QUIC_TEST_SOURCE)" $(QUIC_TEST_LDFLAGS) -o "$(QUIC_TEST_OUTPUT)"
	"$(QUIC_TEST_OUTPUT)" $(QUIC_TEST_ARGS)
