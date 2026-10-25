# Invoke after the configured nginx objs/Makefile; output must be absolute.
.PHONY: verify-quic-adjacent
ifeq ($(shell uname -s),Darwin)
QUIC_ADJACENT_TEST_LDFLAGS ?= -Wl,-dead_strip
else
QUIC_ADJACENT_TEST_LDFLAGS ?= -Wl,--gc-sections
endif
QUIC_ADJACENT_STREAM_SOURCE ?= src/event/quic/ngx_event_quic_streams.c
verify-quic-adjacent:
	mkdir -p "$(dir $(QUIC_ADJACENT_TEST_OUTPUT))"
	sh "$(QUIC_ADJACENT_TEST_EXTRACTOR)" "$(QUIC_ADJACENT_FIN_EXTRACTOR)" "$(QUIC_ADJACENT_STREAM_SOURCE)" src/event/quic/ngx_event_quic_ack.c src/event/quic/ngx_event_quic_output.c "$(QUIC_ADJACENT_TEST_OUTPUT).functions.inc"
	$(CC) $(CFLAGS) $(ALL_INCS) $(QUIC_ADJACENT_TEST_CPPFLAGS) -ffunction-sections -fdata-sections -DQUIC_FIN_FUNCTIONS_INCLUDE='"$(QUIC_ADJACENT_TEST_OUTPUT).functions.inc"' -DQUIC_ADJACENT_SCAFFOLD='"$(QUIC_ADJACENT_SCAFFOLD)"' "$(QUIC_ADJACENT_TEST_SOURCE)" $(QUIC_ADJACENT_TEST_LDFLAGS) -o "$(QUIC_ADJACENT_TEST_OUTPUT)"
	"$(QUIC_ADJACENT_TEST_OUTPUT)" $(QUIC_ADJACENT_TEST_ARGS)
