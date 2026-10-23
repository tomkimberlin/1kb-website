# Invoke from configured nginx source, after its generated objs/Makefile.
# No copied nginx implementation or Python is needed by this target.
.PHONY: verify-quic-stream-offset
ifeq ($(shell uname -s),Darwin)
QUIC_STREAM_TEST_LDFLAGS ?= -Wl,-dead_strip
else
QUIC_STREAM_TEST_LDFLAGS ?= -Wl,--gc-sections
endif
verify-quic-stream-offset:
	mkdir -p "$(dir $(QUIC_STREAM_TEST_OUTPUT))"
	sh "$(QUIC_STREAM_TEST_EXTRACTOR)" src/event/quic/ngx_event_quic_ack.c "$(QUIC_STREAM_TEST_OUTPUT).resend.inc"
	$(CC) $(CFLAGS) $(ALL_INCS) $(QUIC_STREAM_TEST_CPPFLAGS) -ffunction-sections -fdata-sections -DQUIC_STREAM_RESEND_INCLUDE='"$(QUIC_STREAM_TEST_OUTPUT).resend.inc"' "$(QUIC_STREAM_TEST_SOURCE)" $(QUIC_STREAM_TEST_LDFLAGS) -o "$(QUIC_STREAM_TEST_OUTPUT)"
	"$(QUIC_STREAM_TEST_OUTPUT)"
