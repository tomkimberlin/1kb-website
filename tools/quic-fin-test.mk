# Invoke after the actual configured nginx objs/Makefile. Absolute output path.
.PHONY: verify-quic-fin
ifeq ($(shell uname -s),Darwin)
QUIC_FIN_TEST_LDFLAGS ?= -Wl,-dead_strip
else
QUIC_FIN_TEST_LDFLAGS ?= -Wl,--gc-sections
endif
verify-quic-fin:
	mkdir -p "$(dir $(QUIC_FIN_TEST_OUTPUT))"
	sh "$(QUIC_FIN_TEST_EXTRACTOR)" src/event/quic/ngx_event_quic_streams.c src/event/quic/ngx_event_quic_ack.c src/event/quic/ngx_event_quic_output.c "$(QUIC_FIN_TEST_OUTPUT).functions.inc"
	$(CC) $(CFLAGS) $(ALL_INCS) $(QUIC_FIN_TEST_CPPFLAGS) -ffunction-sections -fdata-sections -DQUIC_FIN_FUNCTIONS_INCLUDE='"$(QUIC_FIN_TEST_OUTPUT).functions.inc"' "$(QUIC_FIN_TEST_SOURCE)" $(QUIC_FIN_TEST_LDFLAGS) -o "$(QUIC_FIN_TEST_OUTPUT)"
	"$(QUIC_FIN_TEST_OUTPUT)" "$(QUIC_FIN_TEST_OUTPUT).vectors.json"
