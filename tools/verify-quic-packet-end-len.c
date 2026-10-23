/* Actual configured transport, buffers, output, and protection implementation.
 * Deterministic allocation/log scaffolding; no event loop, sockets, TLS handshake.
 * Known synthetic AES keys are local fixtures, not production secrets. */
#include <ngx_event_quic_connection.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define CHECK(x)                                                                                   \
    do {                                                                                           \
        if (!(x)) {                                                                                \
            fprintf(stderr, "FAIL %d: %s\n", __LINE__, #x);                                        \
            exit(1);                                                                               \
        }                                                                                          \
    } while (0)
#define TEST_CANDIDATE 1
#ifndef QUIC_PACKET_STATE_INCLUDE
#error The exact configured-source extractor output is required
#endif
static void *allocs[65536];
static size_t nalloc, tests, packets, omissions, bytes_removed, split_cases;
static FILE *vectors;
static size_t congestion_lost_calls, idle_calls, close_calls, lifecycle_cases;
static size_t unselected_cases, complete_split_packets, gso_boundaries, crypto_cases,
    implicit_cases;
static ngx_quic_stream_t *lookup;
volatile ngx_msec_t ngx_current_msec = 1000;
ngx_queue_t ngx_posted_events;
static void *allocate(size_t n)
{
    void *p = calloc(1, n ? n : 1);
    CHECK(p && nalloc < 65536);
    allocs[nalloc++] = p;
    return p;
}
void *ngx_palloc(ngx_pool_t *p, size_t n)
{
    return allocate(n);
}
void *ngx_pnalloc(ngx_pool_t *p, size_t n)
{
    return allocate(n);
}
ngx_chain_t *ngx_alloc_chain_link(ngx_pool_t *p)
{
    return allocate(sizeof(ngx_chain_t));
}
void ngx_log_error_core(ngx_uint_t l, ngx_log_t *log, ngx_err_t e, const char *fmt, ...)
{
    fprintf(stderr, "nginx error: %s\n", fmt);
    exit(2);
}
void ngx_ssl_error(ngx_uint_t l, ngx_log_t *log, ngx_err_t e, char *fmt, ...)
{
    fprintf(stderr, "SSL error: %s\n", fmt);
    exit(2);
}
#include <ngx_event_quic_frames.c>
#include <ngx_event_quic_transport.c>
#define ngx_quic_encrypt real_nginx_encrypt
#include <ngx_event_quic_protection.c>
#undef ngx_quic_encrypt
static unsigned char last_plain[65536], last_cipher[65536];
static size_t plain_len, cipher_len, pn_len, header_len;
static unsigned packet_level;
static uint64_t packet_number;
static void hex(FILE *f, const unsigned char *p, size_t n)
{
    size_t i;
    fputc('"', f);
    for (i = 0; i < n; i++)
        fprintf(f, "%02x", p[i]);
    fputc('"', f);
}
ngx_int_t ngx_quic_encrypt(ngx_quic_header_t *p, ngx_str_t *out)
{
    u_char h[256], *pn;
    CHECK(p->num_len >= 1 && p->num_len <= 4);
    CHECK(p->payload.len >= (size_t) (4 - p->num_len));
    plain_len = p->payload.len;
    memcpy(last_plain, p->payload.data, plain_len);
    pn_len = p->num_len;
    packet_level = p->level;
    packet_number = p->number;
    header_len = ngx_quic_create_header(p, h, &pn);
    CHECK(real_nginx_encrypt(p, out) == NGX_OK);
    cipher_len = out->len;
    memcpy(last_cipher, out->data, cipher_len);
    CHECK(cipher_len == header_len + plain_len + 16);
    packets++;
    if (packets > 1)
        fputs(",\n", vectors);
    fprintf(vectors,
            "{\"level\":%u,\"number\":%llu,\"pnLength\":%zu,\"headerLength\":%zu,\"plaintext\":",
            packet_level, (unsigned long long)packet_number, pn_len, header_len);
    hex(vectors, last_plain, plain_len);
    fputs(",\"ciphertext\":", vectors);
    hex(vectors, last_cipher, cipher_len);
    fputc('}', vectors);
    return NGX_OK;
}
void ngx_quic_congestion_idle(ngx_connection_t *c, ngx_uint_t idle)
{
    idle_calls++;
}
static void ngx_quic_congestion_lost(ngx_connection_t *c, ngx_quic_frame_t *f)
{
    congestion_lost_calls++;
}
ngx_quic_stream_t *ngx_quic_find_stream(ngx_rbtree_t *tree, uint64_t id)
{
    return lookup && lookup->id == id ? lookup : NULL;
}
static ngx_int_t ngx_quic_close_stream(ngx_quic_stream_t *qs)
{
    CHECK(qs == lookup);
    close_calls++;
    return NGX_OK;
}
#include QUIC_PACKET_STATE_INCLUDE
#include <ngx_event_quic_output.c>
_Static_assert(NGX_QUIC_OPENSSL_API == 1, "Native OpenSSL required");
static unsigned char payload[32768], key[16], hp[16], iv[12];
static uint64_t selected_offset;
static unsigned selected_fin = 1;
struct fixture {
    ngx_connection_t c;
    ngx_quic_socket_t socket;
    ngx_quic_connection_t qc;
    ngx_quic_keys_t keys;
    ngx_quic_path_t path;
    ngx_quic_client_id_t cid;
    ngx_log_t log;
    ngx_pool_t pool;
};
static ngx_quic_send_ctx_t *ctx(struct fixture *f, unsigned level)
{
    return ngx_quic_get_send_ctx(&f->qc, level);
}
static void init(struct fixture *f, unsigned level, unsigned pn)
{
    size_t i;
    ngx_quic_secret_t *s;
    memset(f, 0, sizeof(*f));
    f->c.udp = &f->socket.udp;
    f->socket.quic = &f->qc;
    f->c.pool = &f->pool;
    f->c.log = &f->log;
    f->qc.keys = &f->keys;
    f->qc.path = &f->path;
    f->path.cid = &f->cid;
    f->cid.len = 8;
    memset(f->cid.id, 0x11, 8);
    f->qc.version = 1;
    f->qc.max_frames = 65536;
    ngx_queue_init(&f->qc.free_frames);
    ngx_queue_init(&ngx_posted_events);
    for (i = 0; i < NGX_QUIC_SEND_CTX_LAST; i++) {
        ngx_queue_init(&f->qc.send_ctx[i].frames);
        ngx_queue_init(&f->qc.send_ctx[i].sending);
        ngx_queue_init(&f->qc.send_ctx[i].sent);
    }
    ctx(f, level)->level = level;
    ctx(f, level)->pnum = (uint64_t[]){1, 128, 32768, 8388608}[pn - 1];
    ctx(f, level)->largest_ack = 0;
    s = &f->keys.secrets[level].server;
    s->iv.len = 12;
    memcpy(s->iv.data, iv, 12);
    memcpy(s->hp.data, hp, 16);
    s->ctx = EVP_CIPHER_CTX_new();
    CHECK(s->ctx);
    CHECK(EVP_EncryptInit_ex(s->ctx, EVP_aes_128_gcm(), NULL, key, NULL));
    CHECK(EVP_CIPHER_CTX_ctrl(s->ctx, EVP_CTRL_AEAD_SET_IVLEN, 12, NULL));
    CHECK(ngx_quic_crypto_hp_init(EVP_aes_128_ctr(), s, &f->log) == NGX_OK);
}
static void cleanup(struct fixture *f, unsigned level)
{
    ngx_quic_secret_t *s = &f->keys.secrets[level].server;
    EVP_CIPHER_CTX_free(s->ctx);
    EVP_CIPHER_CTX_free(s->hp_ctx);
}
static ngx_quic_frame_t *stream(struct fixture *f, unsigned level, size_t n, uint64_t offset,
                                unsigned fin)
{
    ngx_quic_frame_t *p = ngx_quic_alloc_frame(&f->c);
    ngx_buf_t *b = allocate(sizeof(*b));
    ngx_chain_t *ch = allocate(sizeof(*ch));
    CHECK(p);
    p->type = NGX_QUIC_FT_STREAM;
    p->level = level;
    p->need_ack = 1;
    p->u.stream.stream_id = 0;
    p->u.stream.offset = offset;
    p->u.stream.length = n;
    p->u.stream.off = 1;
    p->u.stream.len = 1;
    p->u.stream.fin = fin;
    b->memory = 1;
    b->pos = payload;
    b->last = payload + n;
    b->start = b->pos;
    b->end = b->last;
    b->shadow = b;
    b->num = 1;
    ch->buf = b;
    ch->next = NULL;
    p->data = ch;
    p->len = ngx_quic_create_frame(NULL, p);
    CHECK(p->len > 0);
    ngx_queue_insert_tail(&ctx(f, level)->frames, &p->queue);
    return p;
}
static ngx_quic_frame_t *ping(struct fixture *f, unsigned level)
{
    ngx_quic_frame_t *p = ngx_quic_alloc_frame(&f->c);
    p->type = NGX_QUIC_FT_PING;
    p->level = level;
    p->need_ack = 1;
    p->len = ngx_quic_create_frame(NULL, p);
    ngx_queue_insert_tail(&ctx(f, level)->frames, &p->queue);
    return p;
}
static uint64_t integer(const unsigned char **p, const unsigned char *end)
{
    size_t n, i;
    uint64_t v;
    CHECK(*p < end);
    n = (size_t)1 << (**p >> 6);
    CHECK((size_t)(end - *p) >= n);
    v = *(*p)++ & 63;
    for (i = 1; i < n; i++)
        v = (v << 8) | *(*p)++;
    return v;
}
/* Independent plaintext parser; explicit LEN never absorbs following frames. */
static size_t parse(size_t expected_streams, size_t expected_bytes, unsigned final_len,
                    uint64_t first_offset, unsigned first_fin)
{
    const unsigned char *p = last_plain, *end = p + plain_len;
    size_t count = 0, total = 0;
    unsigned last_len = 9;
    while (p < end) {
        unsigned type = *p++;
        uint64_t id, off, n;
        if (type == 0 || type == 1)
            continue;
        if (type == 2) {
            integer(&p, end);
            integer(&p, end);
            CHECK(integer(&p, end) == 0);
            integer(&p, end);
            continue;
        }
        CHECK((type & 0xf8) == 8);
        id = integer(&p, end);
        off = (type & 4) ? integer(&p, end) : 0;
        n = (type & 2) ? integer(&p, end) : (size_t)(end - p);
        CHECK(id == 0 && n <= (uint64_t)(end - p));
        CHECK(off + n <= ((uint64_t)1 << 62) - 1);
        CHECK(off == (count == 0 ? first_offset : 11));
        CHECK(!!(type & 1) == (count == 0 ? first_fin : 0));
        CHECK(!memcmp(p, payload, n));
        p += n;
        total += n;
        count++;
        last_len = !!(type & 2);
    }
    CHECK(count == expected_streams && total == expected_bytes);
    if (expected_streams)
        CHECK(last_len == final_len);
    return total;
}
static void case_one(size_t n, unsigned pn, unsigned level, unsigned tail, size_t min_extra,
                     unsigned split)
{
    struct fixture f;
    ngx_quic_frame_t *a, *last;
    ngx_quic_stream_frame_t saved;
    ngx_chain_t *chain;
    ngx_buf_t saved_buf;
    ssize_t cached, out;
    size_t baseline, maximum, minimum, width, expected, old_packets = packets;
    unsigned eligible;
    unsigned char wire[65536];
    ngx_quic_header_t packet;
    init(&f, level, pn);
    a = stream(&f, level, n, selected_offset, selected_fin);
    last = a;
    if (tail == 1 || tail == 3)
        last = ping(&f, level);
    else if (tail == 2)
        last = stream(&f, level, 3, 11, 0);
    if (tail == 3) {
        last->type = NGX_QUIC_FT_ACK;
        memset(&last->u, 0, sizeof(last->u));
        last->len = ngx_quic_create_frame(NULL, last);
    }
    cached = a->len;
    saved = a->u.stream;
    chain = a->data;
    saved_buf = *chain->buf;
    baseline = a->len + (tail ? last->len : 0);
    ngx_quic_init_packet(&f.c, ctx(&f, level), &packet, &f.path);
    packet.payload.len = baseline;
    maximum = baseline + ngx_quic_create_header(&packet, wire, (u_char *[]){NULL}) + 16;
    minimum = 0;
    if (min_extra)
        minimum = maximum - (min_extra - 1);
    if (split)
        maximum -= n / 2;
    width = ngx_quic_varint_len(last->u.stream.length);
    eligible = level == NGX_QUIC_ENCRYPTION_APPLICATION && tail != 1 && tail != 3 &&
               baseline >= width && baseline - width >= 4 - pn;
    if (minimum && baseline - width < ngx_quic_payload_size(&packet, minimum))
        eligible = 0;
    out = ngx_quic_output_packet(&f.c, ctx(&f, level), wire, maximum, minimum, 0);
    CHECK(out > 0 && packets == old_packets + 1 && pn_len == pn);
    expected = TEST_CANDIDATE && eligible;
    if (!split) {
        CHECK(a->len == cached && !memcmp(&saved, &a->u.stream, sizeof(saved)) &&
              a->data == chain && !memcmp(&saved_buf, chain->buf, sizeof(saved_buf)));
        CHECK(last->u.stream.len || tail == 1 || tail == 3);
        CHECK(a->pkt_need_ack && a->pnum == packet.number && a->plen == (size_t)out);
        parse(tail == 2 ? 2 : 1, n + (tail == 2 ? 3 : 0), expected ? 0 : 1,
              selected_offset, selected_fin);
        CHECK(plain_len == baseline - (expected ? width : 0) || (minimum && plain_len >= baseline));
        if (expected) {
            omissions++;
            bytes_removed += width;
        }
    } else {
        CHECK(!ngx_queue_empty(&ctx(&f, level)->frames));
        CHECK(a->u.stream.len && !a->u.stream.fin);
        split_cases++;
    }
    CHECK(ctx(&f, level)->pnum == packet.number + 1);
    cleanup(&f, level);
    tests++;
}
static void crypto_exclusion(unsigned level)
{
    struct fixture f;
    ngx_quic_frame_t *frame;
    unsigned char wire[65536], expected[128];
    ssize_t length;

    init(&f, level, 2);
    frame = stream(&f, level, 63, 0, 0);
    frame->type = NGX_QUIC_FT_CRYPTO;
    frame->len = ngx_quic_create_frame(NULL, frame);
    length = ngx_quic_create_frame(expected, frame);
    CHECK(length > 0 && length == frame->len);
    CHECK(ngx_quic_output_packet(&f.c, ctx(&f, level), wire, 1460, 0, 0) > 0);
    CHECK(plain_len == (size_t)length && !memcmp(last_plain, expected, plain_len));
    CHECK(frame->type == NGX_QUIC_FT_CRYPTO && frame->u.crypto.length == 63);
    cleanup(&f, level);
    crypto_cases++;
}

static void already_implicit(void)
{
    struct fixture f;
    ngx_quic_frame_t *frame;
    unsigned char wire[65536];
    ssize_t cached;

    init(&f, NGX_QUIC_ENCRYPTION_APPLICATION, 2);
    frame = stream(&f, NGX_QUIC_ENCRYPTION_APPLICATION, 63, 0, 1);
    frame->u.stream.len = 0;
    cached = frame->len = ngx_quic_create_frame(NULL, frame);
    CHECK(ngx_quic_output_packet(&f.c, ctx(&f, NGX_QUIC_ENCRYPTION_APPLICATION), wire, 1460, 0, 0) >
          0);
    CHECK(!frame->u.stream.len && frame->len == cached && frame->u.stream.fin);
    CHECK(plain_len == (size_t)cached);
    parse(1, 63, 0, 0, 1);
    cleanup(&f, NGX_QUIC_ENCRYPTION_APPLICATION);
    implicit_cases++;
}

static void eight_byte_dry_boundary(void)
{
    ngx_quic_frame_t frame;

    memset(&frame, 0, sizeof(frame));
    frame.type = NGX_QUIC_FT_STREAM;
    frame.u.stream.len = 1;
    frame.u.stream.length = (uint64_t)1 << 30;
    CHECK(ngx_quic_varint_len(frame.u.stream.length) == 8);
    CHECK(ngx_quic_create_frame(NULL, &frame) == (ssize_t)frame.u.stream.length + 10);
    CHECK(NGX_QUIC_MAX_UDP_PAYLOAD_SIZE < frame.u.stream.length);
}

static void unselected_tail(void)
{
    struct fixture f;
    ngx_quic_frame_t *first, *later;
    ngx_quic_stream_frame_t saved;
    ngx_quic_header_t packet;
    u_char wire[65536], *pn;
    size_t maximum;

    init(&f, NGX_QUIC_ENCRYPTION_APPLICATION, 2);
    first = stream(&f, NGX_QUIC_ENCRYPTION_APPLICATION, 63, 0, 0);
    later = stream(&f, NGX_QUIC_ENCRYPTION_APPLICATION, 1000, 63, 1);
    saved = later->u.stream;
    ngx_quic_init_packet(&f.c, ctx(&f, NGX_QUIC_ENCRYPTION_APPLICATION), &packet, &f.path);
    packet.payload.len = first->len;
    maximum = first->len + ngx_quic_create_header(&packet, wire, &pn) + 16;
    CHECK(ngx_quic_output_packet(&f.c, ctx(&f, NGX_QUIC_ENCRYPTION_APPLICATION), wire, maximum, 0,
                                 0) > 0);
    CHECK(plain_len == (size_t)first->len - (TEST_CANDIDATE ? 1 : 0));
    CHECK(first->u.stream.len && !first->u.stream.fin);
    CHECK(later->u.stream.len && !later->pkt_need_ack &&
          !memcmp(&saved, &later->u.stream, sizeof(saved)));
    CHECK(ngx_queue_head(&ctx(&f, NGX_QUIC_ENCRYPTION_APPLICATION)->frames) == &later->queue);
    parse(1, 63, TEST_CANDIDATE ? 0 : 1, 0, 0);
    cleanup(&f, NGX_QUIC_ENCRYPTION_APPLICATION);
    unselected_cases++;
}

static void complete_split(void)
{
    struct fixture f;
    ngx_quic_send_ctx_t *application;
    ngx_quic_frame_t *frame;
    uint64_t offset = 0;
    size_t i, count = 0;
    unsigned char wire[65536];
    unsigned char joined[437];
    const unsigned char *p, *end;
    unsigned type;
    uint64_t id, got_offset, n;

    init(&f, NGX_QUIC_ENCRYPTION_APPLICATION, 2);
    application = ctx(&f, NGX_QUIC_ENCRYPTION_APPLICATION);
    stream(&f, NGX_QUIC_ENCRYPTION_APPLICATION, 437, 0, 1);
    while (!ngx_queue_empty(&application->frames)) {
        CHECK(count++ < 8);
        CHECK(ngx_quic_output_packet(&f.c, application, wire, 200, 0, 0) > 0);
        p = last_plain;
        end = p + plain_len;
        type = *p++;
        CHECK((type & 0xf8) == 8);
        id = integer(&p, end);
        got_offset = (type & 4) ? integer(&p, end) : 0;
        n = (type & 2) ? integer(&p, end) : (size_t)(end - p);
        CHECK(id == 0 && got_offset == offset && n == (size_t)(end - p));
        CHECK(offset + n <= sizeof(joined));
        memcpy(joined + offset, p, n);
        offset += n;
        CHECK(!!(type & 1) == (offset == sizeof(joined)));
        for (i = 0; i < 2; i++) {
            ngx_queue_t *head = i ? &application->frames : &application->sending;
            ngx_queue_t *q;
            for (q = ngx_queue_head(head); q != ngx_queue_sentinel(head); q = ngx_queue_next(q)) {
                frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
                CHECK(frame->u.stream.len && frame->u.stream.off);
                CHECK(frame->len == ngx_quic_create_frame(NULL, frame));
            }
        }
        ngx_quic_commit_send(&f.c);
    }
    CHECK(offset == sizeof(joined) && !memcmp(joined, payload, sizeof(joined)));
    CHECK(count == 3);
    complete_split_packets = count;
    cleanup(&f, NGX_QUIC_ENCRYPTION_APPLICATION);
}

static void lifecycle(void)
{
    struct fixture f;
    ngx_quic_stream_t qs;
    ngx_quic_frame_t *frame;
    ngx_quic_stream_frame_t saved;
    uint64_t preserved[NGX_QUIC_SEND_CTX_LAST] = {0};
    unsigned char wire[65536], first[65536];
    size_t first_len, lost_before = congestion_lost_calls, close_before = close_calls;
    ssize_t out;
    ngx_quic_send_ctx_t *application;

    init(&f, NGX_QUIC_ENCRYPTION_APPLICATION, 2);
    application = ctx(&f, NGX_QUIC_ENCRYPTION_APPLICATION);
    frame = stream(&f, NGX_QUIC_ENCRYPTION_APPLICATION, 437, 0, 1);
    saved = frame->u.stream;
    preserved[2] = application->pnum;
    out = ngx_quic_output_packet(&f.c, application, wire, 1460, 0, 0);
    CHECK(out > 0 && frame->plen == (size_t)out);
    first_len = cipher_len;
    memcpy(first, last_cipher, first_len);
    ngx_quic_revert_send(&f.c, preserved);
    CHECK(application->pnum == preserved[2] && !ngx_queue_empty(&application->frames));
    CHECK(frame->u.stream.len && !memcmp(&saved, &frame->u.stream, sizeof(saved)));
    CHECK(ngx_quic_output_packet(&f.c, application, wire, 1460, 0, 0) == out);
    CHECK(first_len == cipher_len && !memcmp(first, last_cipher, first_len));
    ngx_quic_commit_send(&f.c);
    CHECK(f.qc.congestion.in_flight == (size_t)out && !ngx_queue_empty(&application->sent));
    memset(&qs, 0, sizeof(qs));
    qs.id = 0;
    qs.send_state = NGX_QUIC_STREAM_SEND_DATA_SENT;
    qs.sent = 437;
    lookup = &qs;
    ngx_quic_resend_frames(&f.c, application);
    CHECK(congestion_lost_calls == lost_before + 1);
    CHECK(ngx_queue_empty(&application->sent) && !ngx_queue_empty(&application->frames));
    CHECK(frame->u.stream.len && !memcmp(&saved, &frame->u.stream, sizeof(saved)));
    CHECK(ngx_quic_output_packet(&f.c, application, wire, 1460, 0, 0) == out);
    CHECK(frame->pnum == preserved[2] + 1 && frame->plen == (size_t)out);
    ngx_quic_handle_stream_ack(&f.c, frame);
    CHECK(qs.acked == 437 && qs.fin_acked && qs.send_state == NGX_QUIC_STREAM_SEND_DATA_RECVD);
    CHECK(close_calls == close_before + 1 && frame->u.stream.len);
    cleanup(&f, NGX_QUIC_ENCRYPTION_APPLICATION);
    lookup = NULL;
    lifecycle_cases++;
}

int main(int argc, char **argv)
{
    size_t i;
    unsigned pn, level, tail;
    CHECK(argc == 2);
    vectors = fopen(argv[1], "w");
    CHECK(vectors);
    fputs("[\n", vectors);
    memset(key, 0x22, 16);
    memset(hp, 0x33, 16);
    memset(iv, 0x44, 12);
    for (i = 0; i < sizeof(payload); i++)
        payload[i] = (unsigned char)(i % 251);
    /* Position, packet-number width, frame tail and payload-length matrix. */
    for (pn = 1; pn <= 4; pn++) {
        for (level = 0; level < 3; level++) {
            for (tail = 0; tail < 4; tail++) {
                for (i = 0; i < 4; i++) {
                    case_one((size_t[]){0, 1, 63, 64}[i], pn,
                             (unsigned[]){NGX_QUIC_ENCRYPTION_APPLICATION,
                                          NGX_QUIC_ENCRYPTION_INITIAL,
                                          NGX_QUIC_ENCRYPTION_HANDSHAKE}[level],
                             tail, 0, 0);
                }
            }
        }
    }

    /* Exact minimum-size floors, including min == max output calls. */
    for (pn = 1; pn <= 4; pn++) {
        for (i = 1; i <= 5; i++) {
            case_one(63, pn, NGX_QUIC_ENCRYPTION_APPLICATION, 0, i, 0);
        }
    }
    case_one(64, 1, NGX_QUIC_ENCRYPTION_APPLICATION, 0, 2, 0);
    case_one(16384, 4, NGX_QUIC_ENCRYPTION_APPLICATION, 0, 0, 0);
    for (pn = 1; pn <= 4; pn++) {
        case_one(256, pn, NGX_QUIC_ENCRYPTION_APPLICATION, 0, 0, 1);
    }
    for (i = 0; i < 5; i++) {
        selected_offset = (uint64_t[]){0, 63, 64, 16384, (uint64_t)1 << 30}[i];
        selected_fin = 0;
        case_one(63, 2, NGX_QUIC_ENCRYPTION_APPLICATION, 0, 0, 0);
        selected_fin = 1;
        case_one(0, 1, NGX_QUIC_ENCRYPTION_APPLICATION, 0, 0, 0);
    }
    crypto_exclusion(NGX_QUIC_ENCRYPTION_INITIAL);
    crypto_exclusion(NGX_QUIC_ENCRYPTION_HANDSHAKE);
    already_implicit();
    eight_byte_dry_boundary();
    unselected_tail();
    complete_split();
    lifecycle();
    gso_boundaries = 4; /* min == max cases in the four-PN min-extra matrix. */
    CHECK(ngx_quic_varint_len((uint64_t)1 << 30) == 8);
    /* These counts cover the complete mandatory C fixture. The paired Python
     * reader separately counts all omitted fields, including auxiliary cases. */
    CHECK(tests == 228 && packets == 238);
    CHECK(omissions == 57 && bytes_removed == 64 && split_cases == 4);
    CHECK(lifecycle_cases == 1 && unselected_cases == 1);
    CHECK(complete_split_packets == 3 && gso_boundaries == 4);
    CHECK(crypto_cases == 2 && implicit_cases == 1);
    fputs("\n]\n", vectors);
    CHECK(!fclose(vectors));
    printf(
        "{\"cases\":%zu,\"encryptedPackets\":%zu,\"matrixOmittedFields\":%zu,\"matrixComponentBytesRemoved\":%"
        "zu,\"splitCases\":%zu,\"eightByteLengthDryBoundary\":1,\"lifecycleCases\":%zu,"
        "\"unselectedTailCases\":%zu,\"completeSplitPackets\":%zu,\"gsoMinEqualsMaxCases\":%zu,"
        "\"validCryptoLevelCases\":%zu,\"alreadyImplicitCases\":%zu}\n",
        tests, packets, omissions, bytes_removed, split_cases, lifecycle_cases, unselected_cases,
        complete_split_packets, gso_boundaries, crypto_cases, implicit_cases);
    for (i = 0; i < nalloc; i++)
        free(allocs[i]);
    return 0;
}
