/* Actual current configured nginx types, serializer/buffer/split source and exact
 * loss-requeue function. Only pool allocation, logging, stream lookup and the
 * congestion callback are deterministic test scaffolding; no socket/TLS work. */
#include <ngx_event_quic_connection.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

#define CHECK(x) do {                                                     \
    if (!(x)) {                                                           \
        fprintf(stderr, "FAIL %d: %s\n", __LINE__, #x);                     \
        exit(1);                                                          \
    }                                                                     \
} while (0)

#define MAX62 (((uint64_t) 1 << 62) - 1)

static void *allocations[65536];
static size_t nalloc;

static void *allocate(size_t n)
{
    void *p = calloc(1, n ? n : 1);

    CHECK(p && nalloc < 65536);
    allocations[nalloc++] = p;
    return p;
}

void *ngx_palloc(ngx_pool_t *pool, size_t n)
{
    return allocate(n);
}

void *ngx_pnalloc(ngx_pool_t *pool, size_t n)
{
    return allocate(n);
}

ngx_chain_t *ngx_alloc_chain_link(ngx_pool_t *pool)
{
    return allocate(sizeof(ngx_chain_t));
}

void ngx_log_error_core(ngx_uint_t level, ngx_log_t *log, ngx_err_t err,
    const char *fmt, ...)
{
    fprintf(stderr, "Unexpected nginx error path: %s\n", fmt);
    exit(2);
}

ngx_queue_t ngx_posted_events;
static size_t congestion_calls;
static ngx_quic_stream_t *lookup;

static void ngx_quic_congestion_lost(ngx_connection_t *c, ngx_quic_frame_t *f)
{
    congestion_calls++;
}

ngx_quic_stream_t *ngx_quic_find_stream(ngx_rbtree_t *tree, uint64_t id)
{
    return lookup && lookup->id == id ? lookup : NULL;
}

#include <ngx_event_quic_transport.c>
#include <ngx_event_quic_frames.c>
#ifndef QUIC_STREAM_RESEND_INCLUDE
#error The make target must generate the pinned loss-requeue include
#endif
#include QUIC_STREAM_RESEND_INCLUDE
_Static_assert(NGX_QUIC_OPENSSL_API == 1, "Native OpenSSL QUIC API required");

/* Independent RFC 9000 parser: no nginx wire helpers. */
struct decoded {
    uint64_t id, offset, length;
    unsigned off, len, fin;
    const unsigned char *payload;
};

static int read_int(const unsigned char **p, const unsigned char *end,
    uint64_t *out)
{
    size_t n, i;

    if (*p == end) {
        return 0;
    }

    n = (size_t) 1 << (**p >> 6);
    if ((size_t) (end - *p) < n) {
        return 0;
    }

    *out = *(*p)++ & 63;
    for (i = 1; i < n; i++) {
        *out = (*out << 8) | *(*p)++;
    }
    return 1;
}

static size_t width(uint64_t v)
{
    return v < 64 ? 1 : v < 16384 ? 2 : v < ((uint64_t) 1 << 30) ? 4 : 8;
}

static int decode(const unsigned char *data, size_t size, struct decoded *d)
{
    const unsigned char *p = data, *end = data + size;
    uint64_t type;

    memset(d, 0, sizeof(*d));
    if (!read_int(&p, end, &type) || type < 8 || type > 15
        || !read_int(&p, end, &d->id))
    {
        return 0;
    }

    d->off = !!(type & 4);
    d->len = !!(type & 2);
    d->fin = !!(type & 1);
    if (d->off && !read_int(&p, end, &d->offset)) {
        return 0;
    }

    if (d->len) {
        if (!read_int(&p, end, &d->length)) {
            return 0;
        }
    } else {
        d->length = end - p;
    }

    if (d->length > (uint64_t) (end - p)
        || d->offset > MAX62 - d->length)
    {
        return 0;
    }

    d->payload = p;
    p += d->length;
    return p == end;
}

static unsigned char payload[2048];
static int matrix_phase = 1;
static size_t matrix_cases, matrix_bytes, zero_explicit, split_cases;
static size_t split_fragments, split_bounds, requeue_cases;
static size_t malformed_rejections, implicit_length_controls;

static size_t serialize(ngx_quic_frame_t *f, unsigned char *wire)
{
    ngx_quic_frame_t before;
    unsigned char guarded[2304];
    ssize_t n, w;
    size_t i;

    f->need_ack = 1;
    before = *f;
    memset(guarded, 0xa5, sizeof(guarded));

    /* Dry-run and real writes must agree without changing frame state. */
    n = ngx_quic_create_frame(NULL, f);
    CHECK(n >= 0 && n < 2200);
    CHECK(!memcmp(&before, f, sizeof(before)));
    w = ngx_quic_create_frame(guarded + 8, f);
    CHECK(w == n && !memcmp(&before, f, sizeof(before)));

    for (i = 0; i < 8; i++) {
        CHECK(guarded[i] == 0xa5);
    }
    for (i = 8 + n; i < sizeof(guarded); i++) {
        CHECK(guarded[i] == 0xa5);
    }

    memcpy(wire, guarded + 8, n);
    return n;
}

static void check_stream(ngx_quic_frame_t *f, size_t expected_payload_start)
{
    unsigned char wire[2304];
    struct decoded d;
    size_t n, expected;
    unsigned off;
    ngx_buf_t before_buf[3];
    ngx_chain_t *cl;
    size_t count = 0;

    for (cl = f->data; cl; cl = cl->next) {
        CHECK(count < 3);
        before_buf[count++] = *cl->buf;
    }

    n = serialize(f, wire);
    CHECK(decode(wire, n, &d));
    off = f->u.stream.off && f->u.stream.offset != 0;
    expected = 1 + width(f->u.stream.stream_id)
               + (off ? width(f->u.stream.offset) : 0)
               + (f->u.stream.len ? width(f->u.stream.length) : 0)
               + f->u.stream.length;
    CHECK(n == expected && d.id == f->u.stream.stream_id
          && d.offset == f->u.stream.offset
          && d.length == f->u.stream.length);
    CHECK(d.off == off && d.len == f->u.stream.len
          && d.fin == f->u.stream.fin);
    CHECK(!memcmp(d.payload, payload + expected_payload_start, d.length));

    count = 0;
    for (cl = f->data; cl; cl = cl->next) {
        CHECK(!memcmp(&before_buf[count++], cl->buf, sizeof(ngx_buf_t)));
    }

    if (matrix_phase) {
        matrix_cases++;
        matrix_bytes += n;
        if (f->u.stream.off && f->u.stream.offset == 0) {
            zero_explicit++;
        }
    }

    if (f->u.stream.len) {
        CHECK(!decode(wire, n - 1, &d));
        malformed_rejections++;
    }

    wire[n] = 0x55;
    if (f->u.stream.len
        || f->u.stream.offset == MAX62 - f->u.stream.length)
    {
        CHECK(!decode(wire, n + 1, &d));
        malformed_rejections++;
    } else {
        /* Without LEN, an appended byte is valid payload, not malformed. */
        CHECK(decode(wire, n + 1, &d)
              && d.length == f->u.stream.length + 1
              && d.payload[d.length - 1] == 0x55);
        implicit_length_controls++;
    }
}

static void matrix(void)
{
    static const uint64_t offsets[] = {
        0, 1, 63, 64, 16383, 16384, 1073741823, 1073741824, MAX62
    };
    static const uint64_t ids[] = {
        0, 3, 7, 63, 64, 16383, 16384, 1073741824, MAX62
    };
    static const size_t lengths[] = {0, 1, 63, 64, 127, 1024};
    size_t a, b, c, i, start, n, part, chains;
    unsigned flag, off;

    for (a = 0; a < sizeof(offsets) / sizeof(*offsets); a++) {
        for (b = 0; b < sizeof(ids) / sizeof(*ids); b++) {
            for (c = 0; c < sizeof(lengths) / sizeof(*lengths); c++) {
                n = lengths[c];
                if (offsets[a] > MAX62 - n) {
                    continue;
                }

                for (flag = 0; flag < 4; flag++) {
                    for (chains = 1; chains <= 3; chains++) {
                        for (off = 0; off <= 1; off++) {
                            ngx_quic_frame_t f;
                            ngx_buf_t bufs[3];
                            ngx_chain_t links[3];

                            if (!off && offsets[a]) {
                                continue;
                            }
                            memset(&f, 0, sizeof(f));
                            memset(bufs, 0, sizeof(bufs));
                            memset(links, 0, sizeof(links));
                            f.type = NGX_QUIC_FT_STREAM;
                            f.u.stream.stream_id = ids[b];
                            f.u.stream.offset = offsets[a];
                            f.u.stream.length = n;
                            f.u.stream.off = off;
                            f.u.stream.len = flag & 1;
                            f.u.stream.fin = !!(flag & 2);

                            for (i = 0, start = 0; i < chains; i++) {
                                part = i + 1 == chains ? n - start
                                                      : n / chains;
                                bufs[i].pos = payload + start;
                                bufs[i].last = bufs[i].pos + part;
                                links[i].buf = &bufs[i];
                                links[i].next = i + 1 == chains ? NULL
                                                               : &links[i + 1];
                                start += part;
                            }
                            f.data = links;
                            check_stream(&f, 0);
                        }
                    }
                }
            }
        }
    }
}

static ngx_chain_t *chain(size_t length, size_t count)
{
    ngx_chain_t *head = NULL, **next = &head;
    size_t i, start = 0, n;

    for (i = 0; i < count; i++) {
        ngx_chain_t *cl = allocate(sizeof(*cl));
        ngx_buf_t *b = allocate(sizeof(*b));
        n = i + 1 == count ? length - start : length / count;
        b->start = b->pos = payload + start;
        b->last = b->end = b->pos + n;
        b->temporary = 1;
        b->shadow = b;
        b->num = 1;
        cl->buf = b;
        *next = cl;
        next = &cl->next;
        start += n;
    }
    return head;
}

static void initialize(ngx_connection_t *c, ngx_quic_socket_t *socket,
    ngx_quic_connection_t *qc, ngx_pool_t *pool, ngx_log_t *log)
{
    size_t i;

    memset(c, 0, sizeof(*c));
    memset(socket, 0, sizeof(*socket));
    memset(qc, 0, sizeof(*qc));
    memset(pool, 0, sizeof(*pool));
    memset(log, 0, sizeof(*log));
    c->udp = &socket->udp;
    c->pool = pool;
    c->log = log;
    socket->quic = qc;
    qc->max_frames = 4096;
    ngx_queue_init(&ngx_posted_events);
    ngx_queue_init(&qc->free_frames);
    for (i = 0; i < NGX_QUIC_SEND_CTX_LAST; i++) {
        ngx_queue_init(&qc->send_ctx[i].frames);
        ngx_queue_init(&qc->send_ctx[i].sent);
        ngx_queue_init(&qc->send_ctx[i].sending);
    }
}

static void splitting(void)
{
    static const size_t budgets[] = {7, 8, 9, 16, 66, 67, 68, 130, 255};
    static const uint64_t starts[] = {0, 63, 16383, 1073741823};
    static const uint64_t ids[] = {0, 64, 16384, 1073741824};
    size_t test, scenario;

    for (scenario = 0; scenario < 4; scenario++) {
        for (test = 0; test < sizeof(budgets) / sizeof(*budgets); test++) {
            if (scenario && test < 3) {
                continue;
            }

            ngx_connection_t c;
            ngx_quic_socket_t socket;
            ngx_quic_connection_t qc;
            ngx_pool_t pool;
            ngx_log_t log;
            ngx_quic_send_ctx_t *ctx;
            ngx_quic_frame_t *f;
            ngx_queue_t *q;
            size_t total = 0, count = 0;

            initialize(&c, &socket, &qc, &pool, &log);
            ctx = &qc.send_ctx[2];
            f = ngx_quic_alloc_frame(&c);
            CHECK(f);
            f->type = NGX_QUIC_FT_STREAM;
            f->level = NGX_QUIC_ENCRYPTION_APPLICATION;
            f->u.stream.stream_id = ids[scenario];
            f->u.stream.offset = starts[scenario];
            f->u.stream.length = 1024;
            f->u.stream.off = 1;
            f->u.stream.len = 1;
            f->u.stream.fin = 1;
            f->data = chain(1024, 3);
            ngx_quic_queue_frame(&qc, f);
            CHECK(qc.push.posted);
            ngx_delete_posted_event(&qc.push);

            /* Process newly inserted tails too: repeated splitting must retain
             * the internal OFF flag while advancing each tail's offset. */
            for (q = ngx_queue_head(&ctx->frames);
                 q != ngx_queue_sentinel(&ctx->frames);
                 q = ngx_queue_next(q))
            {
                ngx_int_t rc;
                f = ngx_queue_data(q, ngx_quic_frame_t, queue);
                rc = ngx_quic_split_frame(&c, f, budgets[test]);
                if (rc == NGX_DECLINED) {
                    CHECK((size_t) f->len > budgets[test]);
                    CHECK(f->u.stream.length
                          <= ((size_t) f->len - budgets[test]));
                } else {
                    CHECK(rc == NGX_OK && (size_t) f->len <= budgets[test]);
                }
                CHECK(f->u.stream.offset == starts[scenario] + total
                      && f->u.stream.off == 1 && f->u.stream.len == 1);
                CHECK(f->u.stream.fin
                      == (ngx_queue_next(q)
                          == ngx_queue_sentinel(&ctx->frames)));
                CHECK(f->len == (ssize_t) ngx_quic_create_frame(NULL, f));
                check_stream(f, total);
                total += f->u.stream.length;
                count++;
                CHECK(count < 2048);
            }
            CHECK(total == 1024 && count > 1);
            split_cases++;
            split_fragments += count;
        }
    }
}

static void split_boundaries(void)
{
    ngx_connection_t c;
    ngx_quic_socket_t socket;
    ngx_quic_connection_t qc;
    ngx_pool_t pool;
    ngx_log_t log;
    ngx_quic_frame_t *f, before;

    initialize(&c, &socket, &qc, &pool, &log);
    f = ngx_quic_alloc_frame(&c);
    CHECK(f);
    f->type = NGX_QUIC_FT_STREAM;
    f->u.stream.off = 1;
    f->u.stream.len = 1;
    f->u.stream.fin = 1;
    f->u.stream.length = 1;
    f->data = chain(1, 1);
    f->len = ngx_quic_create_frame(NULL, f);
    before = *f;
    CHECK(ngx_quic_split_frame(&c, f, 1) == NGX_DECLINED
          && !memcmp(f, &before, sizeof(before)));
    split_bounds++;
    CHECK(ngx_quic_split_frame(&c, f, f->len) == NGX_OK
          && !memcmp(f, &before, sizeof(before)));
    split_bounds++;
    f->type = NGX_QUIC_FT_PING;
    before = *f;
    CHECK(ngx_quic_split_frame(&c, f, 1) == NGX_DECLINED
          && !memcmp(f, &before, sizeof(before)));
    split_bounds++;
}

static void resending(void)
{
    unsigned variant;

    for (variant = 0; variant < 4; variant++) {
        ngx_connection_t c;
        ngx_quic_socket_t socket;
        ngx_quic_connection_t qc;
        ngx_pool_t pool;
        ngx_log_t log;
        ngx_quic_send_ctx_t *ctx;
        ngx_quic_stream_t qs;
        ngx_quic_frame_t *a, *b;
        ssize_t length;
        size_t calls;

        initialize(&c, &socket, &qc, &pool, &log);
        ctx = &qc.send_ctx[2];
        memset(&qs, 0, sizeof(qs));
        qs.id = 0;
        qs.send_state = variant == 2 ? NGX_QUIC_STREAM_SEND_RESET_SENT
                                     : NGX_QUIC_STREAM_SEND_SEND;
        lookup = variant == 1 ? NULL : &qs;
        qc.closing = variant == 3;
        a = ngx_quic_alloc_frame(&c);
        b = ngx_quic_alloc_frame(&c);
        CHECK(a && b);
        a->type = b->type = NGX_QUIC_FT_STREAM;
        a->pnum = 10;
        b->pnum = 11;
        a->u.stream.off = 1;
        a->u.stream.len = 1;
        a->u.stream.length = 127;
        a->data = chain(127, 2);
        a->len = ngx_quic_create_frame(NULL, a);
        length = a->len;
        ngx_queue_insert_tail(&ctx->sent, &a->queue);
        ngx_queue_insert_tail(&ctx->sent, &b->queue);
        calls = congestion_calls;
        ngx_quic_resend_frames(&c, ctx);
        CHECK(congestion_calls == calls + 1
              && ngx_queue_head(&ctx->sent) == &b->queue
              && ngx_queue_next(&b->queue) == ngx_queue_sentinel(&ctx->sent));
        if (variant == 0 || variant == 3) {
            CHECK(ngx_queue_head(&ctx->frames) == &a->queue
                  && a->pnum == 10 && a->len == length);
            check_stream(a, 0);
        } else {
            CHECK(ngx_queue_empty(&ctx->frames)
                  && ngx_queue_head(&qc.free_frames) == &a->queue);
        }
        CHECK(qc.push.posted == (variant != 3));
        if (qc.push.posted) {
            ngx_delete_posted_event(&qc.push);
        }
        requeue_cases++;
    }
}

int main(void)
{
    size_t i;

    for (i = 0; i < sizeof(payload); i++) {
        payload[i] = (unsigned char) (i * 17 + 5);
    }
    matrix();
    matrix_phase = 0;
    splitting();
    split_boundaries();
    resending();
    for (i = 0; i < sizeof(payload); i++) {
        CHECK(payload[i] == (unsigned char) (i * 17 + 5));
    }

    printf("{\"matrixCases\":%zu,\"matrixBytes\":%zu,"
           "\"zeroExplicitCases\":%zu,\"splitCases\":%zu,"
           "\"splitFragments\":%zu,\"splitBoundaryControls\":%zu,"
           "\"requeueCases\":%zu,\"malformedRejections\":%zu,"
           "\"validImplicitLengthExtensions\":%zu,"
           "\"configuredNativeOpenSSLApi\":%d}\n",
           matrix_cases, matrix_bytes, zero_explicit, split_cases,
           split_fragments, split_bounds, requeue_cases, malformed_rejections,
           implicit_length_controls, (int) NGX_QUIC_OPENSSL_API);
    for (i = 0; i < nalloc; i++) {
        free(allocations[i]);
    }
    return 0;
}
