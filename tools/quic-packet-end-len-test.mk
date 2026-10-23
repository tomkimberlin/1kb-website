# Invoke after the actual configured nginx objs/Makefile.
# CFLAGS and ALL_INCS retain its compiler, hardening options and ABI.
.PHONY: verify-quic-packet-end-len
ifeq ($(shell uname -s),Darwin)
QUIC_PACKET_TEST_LDFLAGS ?= -Wl,-dead_strip
else
QUIC_PACKET_TEST_LDFLAGS ?= -Wl,--gc-sections
endif
QUIC_PACKET_TEST_LIBS ?= -L/opt/openssl/lib -Wl,-rpath,/opt/openssl/lib -lssl -lcrypto
verify-quic-packet-end-len:
	mkdir -p "$(dir $(QUIC_PACKET_TEST_OUTPUT))"
	sh "$(QUIC_PACKET_TEST_EXTRACTOR)" . "$(QUIC_PACKET_TEST_OUTPUT).functions.inc"
	@for unit in output transport protection frames; do \
	  $(CC) $(CFLAGS) $(ALL_INCS) $(QUIC_PACKET_TEST_CPPFLAGS) -ffunction-sections -fdata-sections -c src/event/quic/ngx_event_quic_$$unit.c -o "$(QUIC_PACKET_TEST_OUTPUT).$$unit.o" || exit 1; \
	done
	$(CC) $(CFLAGS) $(ALL_INCS) $(QUIC_PACKET_TEST_CPPFLAGS) -ffunction-sections -fdata-sections -DQUIC_PACKET_STATE_INCLUDE='"$(QUIC_PACKET_TEST_OUTPUT).functions.inc"' "$(QUIC_PACKET_TEST_SOURCE)" $(QUIC_PACKET_TEST_LDFLAGS) $(QUIC_PACKET_TEST_LIBS) -o "$(QUIC_PACKET_TEST_OUTPUT)"
	"$(QUIC_PACKET_TEST_OUTPUT)" "$(QUIC_PACKET_TEST_OUTPUT).vectors.json"
