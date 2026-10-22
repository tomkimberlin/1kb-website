/* Isolated OpenSSL 3.5.8 BIO-pair tests: no sockets or production state.
 * Uses the same self-signed, explicitly trusted fixture pattern as
 * tools/verify-tls-flight.c. Build against the matching internal source tree.
 */
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/x509.h>
#include <openssl/ec.h>
#include "ssl/ssl_local.h"
#include "internal/ssl_unwrap.h"
#include "ssl/statem/statem_local.h"
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define CHECK(x) do { if (!(x)) { fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #x); ERR_print_errors_fp(stderr); exit(1); } } while (0)
#define MAX_TICKETS 16
typedef struct { size_t length, ticket_length, message_length; uint64_t value; unsigned char bytes[8]; } Nonce;
typedef struct {
    SSL_CTX *cc, *sc;
    SSL *c, *s;
    Nonce nonces[MAX_TICKETS];
    SSL_SESSION *sessions[MAX_TICKETS];
    unsigned messages, session_count, alerts, writes_blocked;
    uint64_t seed;
    int seed_pending;
    size_t capacity;
} Pair;
static int pair_index;
static unsigned passed;

static void done(const char *name) { passed++; printf("{\"case\":\"%s\",\"verified\":true}\n", name); }
static size_t canonical_length(uint64_t value) { size_t n = 0; while (value) { n++; value >>= 8; } return n; }
static void record_message(int writing, int version, int type, const void *data, size_t length, SSL *ssl, void *arg)
{
    Pair *p = arg;
    const unsigned char *v = data;
    (void)version;
    if (writing && ssl == p->s && type == SSL3_RT_HANDSHAKE && length && v[0] == SSL3_MT_FINISHED && p->seed_pending) {
        SSL_CONNECTION_FROM_SSL(ssl)->next_ticket_nonce = p->seed;
        p->seed_pending = 0;
    }
    if (!writing && ssl == p->c && type == SSL3_RT_ALERT && length == 2) p->alerts++;
    if (writing || ssl != p->c || type != SSL3_RT_HANDSHAKE || !length || v[0] != SSL3_MT_NEWSESSION_TICKET || SSL_version(ssl) != TLS1_3_VERSION) return;
    CHECK(p->messages < MAX_TICKETS && length >= 15);
    CHECK((((size_t)v[1] << 16) | ((size_t)v[2] << 8) | v[3]) == length - 4);
    Nonce *n = &p->nonces[p->messages++];
    n->length = v[12];
    CHECK(n->length <= sizeof(n->bytes) && 13 + n->length + 2 <= length);
    memcpy(n->bytes, v + 13, n->length);
    for (size_t i = 0; i < n->length; i++) n->value = (n->value << 8) | n->bytes[i];
    size_t offset = 13 + n->length;
    n->ticket_length = ((size_t)v[offset] << 8) | v[offset + 1];
    CHECK(n->ticket_length > 0 && offset + 2 + n->ticket_length + 2 <= length);
    offset += 2 + n->ticket_length;
    CHECK(offset + 2 + (((size_t)v[offset] << 8) | v[offset + 1]) == length);
    n->message_length = length;
}
static int capture_session(SSL *ssl, SSL_SESSION *session)
{
    Pair *p = SSL_get_ex_data(ssl, pair_index);
    CHECK(p && p->session_count < MAX_TICKETS);
    /* Returning one transfers the callback's extra reference to this fixture. */
    p->sessions[p->session_count++] = session;
    return 1;
}
static X509 *certificate(EVP_PKEY **key)
{
    EVP_PKEY_CTX *kc = EVP_PKEY_CTX_new_id(EVP_PKEY_EC, NULL); CHECK(kc);
    CHECK(EVP_PKEY_keygen_init(kc) > 0);
    CHECK(EVP_PKEY_CTX_set_ec_paramgen_curve_nid(kc, NID_X9_62_prime256v1) > 0);
    CHECK(EVP_PKEY_keygen(kc, key) > 0); EVP_PKEY_CTX_free(kc);
    X509 *x = X509_new(); CHECK(x && X509_set_version(x, 2));
    CHECK(ASN1_INTEGER_set(X509_get_serialNumber(x), 1));
    CHECK(X509_gmtime_adj(X509_getm_notBefore(x), -60));
    CHECK(X509_gmtime_adj(X509_getm_notAfter(x), 3600));
    CHECK(X509_set_pubkey(x, *key));
    X509_NAME *name = X509_get_subject_name(x);
    CHECK(X509_NAME_add_entry_by_txt(name, "CN", MBSTRING_ASC, (const unsigned char *)"fixture.test", -1, -1, 0));
    CHECK(X509_set_issuer_name(x, name) && X509_sign(x, *key, EVP_sha256()) > 0);
    return x;
}
static void clear_records(Pair *p)
{
    for (unsigned i = 0; i < p->session_count; i++) SSL_SESSION_free(p->sessions[i]);
    memset(p->sessions, 0, sizeof(p->sessions)); memset(p->nonces, 0, sizeof(p->nonces));
    p->messages = p->session_count = p->alerts = p->writes_blocked = 0;
}
static void attach(Pair *p)
{
    BIO *cb = NULL, *sb = NULL; CHECK(BIO_new_bio_pair(&cb, p->capacity, &sb, p->capacity));
    SSL_set_bio(p->c, cb, cb); SSL_set_bio(p->s, sb, sb);
    SSL_set_connect_state(p->c); SSL_set_accept_state(p->s);
    CHECK(SSL_set1_host(p->c, "fixture.test"));
    CHECK(SSL_set_ex_data(p->c, pair_index, p));
    SSL_set_msg_callback(p->c, record_message); SSL_set_msg_callback_arg(p->c, p);
    /* Ordinary cases exercise the existing flight patch without a server callback. */
    SSL_set_msg_callback(p->s, NULL); SSL_set_msg_callback_arg(p->s, NULL);
}
static void seed_counter(Pair *p, uint64_t seed)
{
    p->seed = seed; p->seed_pending = 1;
    SSL_set_msg_callback(p->s, record_message); SSL_set_msg_callback_arg(p->s, p);
}
static void make_pair(Pair *p, int stateful, const char *cipher, unsigned tickets, size_t capacity)
{
    static const unsigned char sid[] = "nonce-regression";
    memset(p, 0, sizeof(*p)); p->capacity = capacity;
    p->cc = SSL_CTX_new(TLS_client_method()); p->sc = SSL_CTX_new(TLS_server_method()); CHECK(p->cc && p->sc);
    CHECK(SSL_CTX_set_min_proto_version(p->cc, TLS1_3_VERSION) && SSL_CTX_set_max_proto_version(p->cc, TLS1_3_VERSION));
    CHECK(SSL_CTX_set_min_proto_version(p->sc, TLS1_3_VERSION) && SSL_CTX_set_max_proto_version(p->sc, TLS1_3_VERSION));
    CHECK(SSL_CTX_set_ciphersuites(p->cc, cipher) && SSL_CTX_set_ciphersuites(p->sc, cipher));
    CHECK(SSL_CTX_set_num_tickets(p->sc, tickets));
    SSL_CTX_set_session_cache_mode(p->sc, SSL_SESS_CACHE_SERVER);
    SSL_CTX_set_session_cache_mode(p->cc, SSL_SESS_CACHE_CLIENT | SSL_SESS_CACHE_NO_INTERNAL_STORE);
    SSL_CTX_sess_set_new_cb(p->cc, capture_session);
    CHECK(SSL_CTX_set_session_id_context(p->sc, sid, sizeof(sid)));
    if (stateful) SSL_CTX_set_options(p->sc, SSL_OP_NO_TICKET);
    EVP_PKEY *key = NULL; X509 *cert = certificate(&key);
    CHECK(SSL_CTX_use_certificate(p->sc, cert) && SSL_CTX_use_PrivateKey(p->sc, key) && SSL_CTX_check_private_key(p->sc));
    CHECK(X509_STORE_add_cert(SSL_CTX_get_cert_store(p->cc), cert));
    SSL_CTX_set_verify(p->cc, SSL_VERIFY_PEER, NULL);
    X509_free(cert); EVP_PKEY_free(key);
    p->c = SSL_new(p->cc); p->s = SSL_new(p->sc); CHECK(p->c && p->s); attach(p);
}
static void quiet(Pair *p)
{
    SSL_set_quiet_shutdown(p->c, 1); SSL_set_quiet_shutdown(p->s, 1);
    (void)SSL_shutdown(p->c); (void)SSL_shutdown(p->s);
}
static void release(Pair *p)
{
    quiet(p); SSL_free(p->c); SSL_free(p->s); clear_records(p); SSL_CTX_free(p->cc); SSL_CTX_free(p->sc);
}
static int progress(SSL *ssl, Pair *p)
{
    ERR_clear_error(); int r = SSL_do_handshake(ssl); if (r == 1) return 1;
    int e = SSL_get_error(ssl, r); if (e == SSL_ERROR_WANT_WRITE) p->writes_blocked++;
    CHECK(e == SSL_ERROR_WANT_READ || e == SSL_ERROR_WANT_WRITE); return 0;
}
static void handshake(Pair *p)
{
    int cd = 0, sd = 0;
    for (unsigned i = 0; i < 20000 && !(cd && sd); i++) {
        if (!cd) cd = progress(p->c, p);
        if (!sd) sd = progress(p->s, p);
        if (cd && !sd) { unsigned char out[16]; size_t n = 0; ERR_clear_error(); int r = SSL_read_ex(p->c, out, sizeof(out), &n); CHECK(!r && n == 0); int e = SSL_get_error(p->c, r); CHECK(e == SSL_ERROR_WANT_READ || e == SSL_ERROR_WANT_WRITE); }
    }
    CHECK(cd && sd && SSL_get_verify_result(p->c) == X509_V_OK);
}
static void exchange(Pair *p)
{
    static const char payload[] = "verified ticket application data";
    unsigned char out[sizeof(payload)]; size_t nw = 0, nr = 0; int wd = 0, rd = 0;
    for (unsigned i = 0; i < 20000 && !(wd && rd); i++) {
        if (!wd) { ERR_clear_error(); int r = SSL_write_ex(p->s, payload, sizeof(payload), &nw); if (r) wd = 1; else { int e = SSL_get_error(p->s, r); if (e == SSL_ERROR_WANT_WRITE) p->writes_blocked++; CHECK(e == SSL_ERROR_WANT_READ || e == SSL_ERROR_WANT_WRITE); } }
        if (!rd) { ERR_clear_error(); int r = SSL_read_ex(p->c, out, sizeof(out), &nr); if (r) rd = 1; else { int e = SSL_get_error(p->c, r); CHECK(e == SSL_ERROR_WANT_READ || e == SSL_ERROR_WANT_WRITE); } }
    }
    CHECK(wd && rd && nw == sizeof(payload) && nr == sizeof(payload) && memcmp(payload, out, sizeof(payload)) == 0);
}
static void expect_nonces(Pair *p, uint64_t start, unsigned count)
{
    CHECK(p->messages == count && p->session_count == count);
    for (unsigned i = 0; i < count; i++) {
        const Nonce *n = &p->nonces[i]; uint64_t expected = start + i;
        CHECK(n->value == expected && n->length == canonical_length(expected));
        if (n->length) CHECK(n->bytes[0] != 0);
        CHECK(SSL_SESSION_is_resumable(p->sessions[i]));
        for (unsigned j = 0; j < i; j++) {
            CHECK(n->length != p->nonces[j].length || memcmp(n->bytes, p->nonces[j].bytes, n->length) != 0);
            unsigned char a[SSL_MAX_MASTER_KEY_LENGTH], b[SSL_MAX_MASTER_KEY_LENGTH];
            size_t alen = SSL_SESSION_get_master_key(p->sessions[i], a, sizeof(a)), blen = SSL_SESSION_get_master_key(p->sessions[j], b, sizeof(b));
            CHECK(alen == blen && alen > 0 && memcmp(a, b, alen) != 0);
        }
    }
    if (count) {
        unsigned char a[SSL_MAX_MASTER_KEY_LENGTH], b[SSL_MAX_MASTER_KEY_LENGTH];
        size_t alen = SSL_SESSION_get_master_key(p->sessions[count - 1], a, sizeof(a));
        size_t blen = SSL_SESSION_get_master_key(SSL_get_session(p->s), b, sizeof(b));
        CHECK(alen == blen && alen > 0 && memcmp(a, b, alen) == 0);
    }
}
static void reconnect(Pair *p, SSL_SESSION *session)
{
    quiet(p); SSL_free(p->c); SSL_free(p->s); clear_records(p);
    p->seed_pending = 0; p->c = SSL_new(p->cc); p->s = SSL_new(p->sc); CHECK(p->c && p->s); attach(p);
    CHECK(SSL_set_num_tickets(p->s, 1)); CHECK(SSL_set_session(p->c, session));
    handshake(p); CHECK(SSL_session_reused(p->c) && SSL_session_reused(p->s)); exchange(p); expect_nonces(p, 0, 1);
}
static void run_counter(int stateful, const char *cipher, uint64_t counter, unsigned tickets)
{
    Pair p; make_pair(&p, stateful, cipher, tickets, 32768); if (counter) seed_counter(&p, counter);
    handshake(&p); CHECK(!SSL_session_reused(p.c)); exchange(&p); expect_nonces(&p, counter, tickets);
    SSL_SESSION *sessions[MAX_TICKETS];
    for (unsigned i = 0; i < tickets; i++) { sessions[i] = p.sessions[i]; CHECK(SSL_SESSION_up_ref(sessions[i])); }
    size_t first_len = p.nonces[0].length, first_message = p.nonces[0].message_length;
    for (unsigned i = 0; i < tickets; i++) { reconnect(&p, sessions[i]); SSL_SESSION_free(sessions[i]); }
    char name[160]; snprintf(name, sizeof(name), "%s-%s-counter-%" PRIu64 "-tickets-%u", stateful ? "stateful" : "stateless", cipher, counter, tickets);
    printf("{\"first_nonce_bytes\":%zu,\"first_ticket_message_bytes\":%zu,\"saved_nonce_bytes\":%zu}\n", first_len, first_message, (size_t)8 - first_len);
    release(&p); done(name);
}
static void extra_and_lifecycle(int stateful)
{
    Pair p; make_pair(&p, stateful, "TLS_AES_128_GCM_SHA256", 1, 32768); handshake(&p); exchange(&p); expect_nonces(&p, 0, 1);
    CHECK(SSL_new_session_ticket(p.s)); exchange(&p); expect_nonces(&p, 0, 2);
    SSL_SESSION *second = p.sessions[1]; CHECK(SSL_SESSION_up_ref(second)); reconnect(&p, second); SSL_SESSION_free(second);
    uint64_t next = SSL_CONNECTION_FROM_SSL(p.s)->next_ticket_nonce;
    quiet(&p); CHECK(SSL_clear(p.c) && SSL_clear(p.s) && SSL_set_session(p.c, NULL)); clear_records(&p); p.seed_pending = 0;
    /* SSL_clear preserves this counter in the pinned upstream implementation. */
    CHECK(SSL_CONNECTION_FROM_SSL(p.s)->next_ticket_nonce == next); attach(&p);
    handshake(&p); exchange(&p); expect_nonces(&p, next, 1); release(&p);
    done(stateful ? "stateful-extra-ticket-and-clear-reuse" : "stateless-extra-ticket-and-clear-reuse");
}
static void expect_exhaustion(Pair *p)
{
    int server_failed = 0, client_failed = 0;
    for (unsigned i = 0; i < 20000 && !(server_failed && client_failed); i++) {
        if (!server_failed) {
            ERR_clear_error(); int r = SSL_do_handshake(p->s);
            if (r != 1) { int e = SSL_get_error(p->s, r); if (e != SSL_ERROR_WANT_READ && e != SSL_ERROR_WANT_WRITE) { CHECK(e == SSL_ERROR_SSL); server_failed = 1; } }
        }
        if (!SSL_is_init_finished(p->c)) {
            ERR_clear_error(); int r = SSL_do_handshake(p->c);
            if (r != 1) { int e = SSL_get_error(p->c, r); if (e != SSL_ERROR_WANT_READ && e != SSL_ERROR_WANT_WRITE) { CHECK(e == SSL_ERROR_SSL); client_failed = 1; } }
        } else if (!client_failed) {
            unsigned char b[16]; size_t n = 0; ERR_clear_error(); int r = SSL_read_ex(p->c, b, sizeof(b), &n);
            if (!r) { int e = SSL_get_error(p->c, r); if (e != SSL_ERROR_WANT_READ && e != SSL_ERROR_WANT_WRITE) { CHECK(e == SSL_ERROR_SSL); client_failed = 1; } }
        }
    }
    CHECK(server_failed && client_failed && p->alerts > 0);
    CHECK(SSL_CONNECTION_FROM_SSL(p->s)->next_ticket_nonce == UINT64_MAX); ERR_clear_error();
}
static void exhaustion(int stateful, int extra)
{
    Pair p; make_pair(&p, stateful, "TLS_AES_128_GCM_SHA256", 1, 32768);
    seed_counter(&p, extra ? UINT64_MAX - 1 : UINT64_MAX);
    if (extra) { handshake(&p); exchange(&p); expect_nonces(&p, UINT64_MAX - 1, 1); CHECK(SSL_new_session_ticket(p.s)); }
    expect_exhaustion(&p); CHECK(p.messages == (unsigned)extra && p.session_count == (unsigned)extra);
    release(&p); done(stateful ? (extra ? "stateful-extra-exhaustion" : "stateful-initial-exhaustion") : (extra ? "stateless-extra-exhaustion" : "stateless-initial-exhaustion"));
}
static void tiny_bio(void)
{
    Pair p; make_pair(&p, 1, "TLS_AES_128_GCM_SHA256", 0, 64); handshake(&p); exchange(&p);
    CHECK(SSL_new_session_ticket(p.s)); exchange(&p); expect_nonces(&p, 0, 1);
    CHECK(p.writes_blocked > 0); release(&p); done("tiny-bio-ticket-write-retries");
}
static void parser_case(int kind)
{
    Pair p; make_pair(&p, 0, "TLS_AES_128_GCM_SHA256", 0, 32768); handshake(&p); exchange(&p);
    unsigned char message[300] = {0}; size_t length;
    message[2] = 0x0e; message[3] = 0x10; /* one-hour lifetime */
    if (kind == 1) { message[8] = 255; length = 17; }
    else if (kind == 2) { message[8] = 0; length = 13; } /* forbidden empty TLS1.3 ticket */
    else {
        message[8] = 255;
        for (unsigned i = 0; i < 255; i++) message[9 + i] = (unsigned char)i;
        message[264] = 0; message[265] = 1; message[266] = 'K'; length = 269;
        if (kind == 3) length++; /* inconsistent trailing bytes after extensions */
    }
    PACKET pkt; CHECK(PACKET_buf_init(&pkt, message, length)); ERR_clear_error();
    MSG_PROCESS_RETURN result = tls_process_new_session_ticket(SSL_CONNECTION_FROM_SSL(p.c), &pkt);
    if (kind == 0) CHECK(result == MSG_PROCESS_FINISHED_READING && p.session_count == 1);
    else CHECK(result == MSG_PROCESS_ERROR);
    ERR_clear_error(); release(&p);
    done(kind == 0 ? "client-parser-legal-255-byte-nonce" : kind == 1 ? "client-parser-truncated-255-byte-nonce" : kind == 2 ? "client-parser-rejects-empty-ticket" : "client-parser-rejects-trailing-oversized-body");
}
static void tls12(void)
{
    Pair p; make_pair(&p, 0, "TLS_AES_128_GCM_SHA256", 1, 32768);
    CHECK(SSL_set_min_proto_version(p.c, TLS1_2_VERSION) && SSL_set_max_proto_version(p.c, TLS1_2_VERSION));
    CHECK(SSL_set_min_proto_version(p.s, TLS1_2_VERSION) && SSL_set_max_proto_version(p.s, TLS1_2_VERSION));
    handshake(&p); CHECK(SSL_version(p.c) == TLS1_2_VERSION); exchange(&p); CHECK(p.messages == 0);
    SSL_SESSION *session = SSL_get1_session(p.c); CHECK(session && SSL_SESSION_is_resumable(session));
    quiet(&p); CHECK(SSL_clear(p.c) && SSL_clear(p.s)); clear_records(&p); attach(&p); CHECK(SSL_set_session(p.c, session)); SSL_SESSION_free(session);
    handshake(&p); CHECK(SSL_session_reused(p.c) && SSL_session_reused(p.s)); exchange(&p); release(&p); done("tls12-ticket-and-resumption-unchanged");
}
int main(void)
{
    alarm(60); pair_index = SSL_get_ex_new_index(0, NULL, NULL, NULL, NULL); CHECK(pair_index >= 0);
    printf("{\"openssl\":\"%s\",\"scope\":\"isolated BIO-pair; canonical nonce and actual resumption\"}\n", OpenSSL_version(OPENSSL_VERSION));
    for (int stateful = 0; stateful <= 1; stateful++) {
        for (int hash = 0; hash < 2; hash++) {
            const char *cipher = hash ? "TLS_AES_256_GCM_SHA384" : "TLS_AES_128_GCM_SHA256";
            run_counter(stateful, cipher, 0, 1);
            run_counter(stateful, cipher, 255, 2);
            run_counter(stateful, cipher, 65535, 2);
            run_counter(stateful, cipher, UINT64_MAX - 1, 1);
        }
        extra_and_lifecycle(stateful); exhaustion(stateful, 0); exhaustion(stateful, 1);
    }
    tiny_bio(); for (int kind = 0; kind < 4; kind++) parser_case(kind); tls12();
    printf("{\"passed\":%u,\"failed\":0}\n", passed); return 0;
}
