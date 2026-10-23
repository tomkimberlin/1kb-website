/* Configured nginx types and exact source functions. No sockets or runtime.
 * Allocation, logging, lookup, congestion callbacks and stream-close observation
 * are deterministic scaffolding. The actual stream-close implementation is not
 * exercised; its call and return propagation are checked. */
#include <ngx_event_quic_connection.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(x) do {                                                     \
    if (!(x)) {                                                          \
        fprintf(stderr, "FAIL %d: %s\n", __LINE__, #x);                    \
        exit(1);                                                         \
    }                                                                    \
} while (0)
#define TEST_CANDIDATE 1
#define MAX62 (((uint64_t) 1 << 62) - 1)

static void *allocations[65536];
static size_t nalloc, allocation_attempts, close_calls, congestion_calls;
static size_t idle_calls;
static int fail_allocation;
static ngx_int_t close_result = NGX_OK;
static ngx_quic_stream_t *lookup;

static void *allocate(size_t size)
{
    void *p;
    allocation_attempts++;
    if (fail_allocation) {
        return NULL;
    }
    p = calloc(1, size ? size : 1);
    CHECK(p && nalloc < 65536);
    allocations[nalloc++] = p;
    return p;
}

void *ngx_palloc(ngx_pool_t *pool, size_t size) { return allocate(size); }
void *ngx_pnalloc(ngx_pool_t *pool, size_t size) { return allocate(size); }
ngx_chain_t *ngx_alloc_chain_link(ngx_pool_t *pool)
{
    return allocate(sizeof(ngx_chain_t));
}
void ngx_log_error_core(ngx_uint_t level, ngx_log_t *log, ngx_err_t err,
    const char *format, ...)
{
    fprintf(stderr, "Unexpected nginx error path: %s\n", format);
    exit(2);
}
ngx_queue_t ngx_posted_events;
ngx_quic_stream_t *ngx_quic_find_stream(ngx_rbtree_t *tree, uint64_t id)
{
    return lookup && lookup->id == id ? lookup : NULL;
}
static void ngx_quic_congestion_lost(ngx_connection_t *c, ngx_quic_frame_t *f)
{
    congestion_calls++;
}
void ngx_quic_congestion_idle(ngx_connection_t *c, ngx_uint_t idle)
{
    idle_calls++;
}
static ngx_int_t ngx_quic_close_stream(ngx_quic_stream_t *qs)
{
    CHECK(qs == lookup);
    close_calls++;
    return close_result;
}
static ngx_int_t ngx_quic_stream_flush(ngx_quic_stream_t *qs);
static void ngx_quic_set_event(ngx_event_t *ev);

#include <ngx_event_quic_transport.c>
#include <ngx_event_quic_frames.c>
#ifndef QUIC_FIN_FUNCTIONS_INCLUDE
#error The configured make gate must generate the pinned function include
#endif
#include QUIC_FIN_FUNCTIONS_INCLUDE
_Static_assert(NGX_QUIC_OPENSSL_API == 1, "Native OpenSSL API required");

static unsigned char payload[2048];

struct fixture {
    ngx_connection_t parent, child;
    ngx_quic_socket_t socket;
    ngx_quic_connection_t qc;
    ngx_quic_stream_t qs;
    ngx_quic_conf_t conf;
    ngx_pool_t pool;
    ngx_log_t log;
    ngx_event_t write_event;
};

static ngx_quic_send_ctx_t *context(struct fixture *f)
{
    return &f->qc.send_ctx[2];
}

static size_t queued(ngx_queue_t *queue)
{
    ngx_queue_t *q;
    size_t count = 0;
    for (q = ngx_queue_head(queue); q != ngx_queue_sentinel(queue);
         q = ngx_queue_next(q))
    {
        CHECK(++count < 4096);
    }
    return count;
}

static ngx_quic_frame_t *tail(struct fixture *f)
{
    CHECK(!ngx_queue_empty(&context(f)->frames));
    return ngx_queue_data(ngx_queue_last(&context(f)->frames),
                          ngx_quic_frame_t, queue);
}

static void unpost(ngx_event_t *event)
{
    if (event->posted) {
        ngx_delete_posted_event(event);
    }
}

static void initialize(struct fixture *f, uint64_t start, uint64_t id)
{
    size_t i;
    memset(f, 0, sizeof(*f));
    f->parent.udp = &f->socket.udp;
    f->parent.pool = &f->pool;
    f->parent.log = &f->log;
    f->socket.quic = &f->qc;
    f->qc.max_frames = 4096;
    f->qc.conf = &f->conf;
    f->conf.stream_buffer_size = 4096;
    f->qc.streams.send_max_data = start + 65536;
    f->qc.streams.send_offset = start;
    f->qc.streams.sent = start;
    f->qs.parent = &f->parent;
    f->qs.connection = &f->child;
    f->child.quic = &f->qs;
    f->child.sent = start;
    f->child.write = &f->write_event;
    f->write_event.active = 1;
    f->qs.id = id;
    f->qs.send_state = NGX_QUIC_STREAM_SEND_SEND;
    f->qs.send_max_data = start + 65536;
    f->qs.send_offset = start;
    f->qs.send.offset = start;
    f->qs.send_final_size = (uint64_t) -1;
    f->qs.sent = start;
    f->qs.acked = start;
    ngx_queue_init(&ngx_posted_events);
    ngx_queue_init(&f->qc.free_frames);
    for (i = 0; i < NGX_QUIC_SEND_CTX_LAST; i++) {
        ngx_queue_init(&f->qc.send_ctx[i].frames);
        ngx_queue_init(&f->qc.send_ctx[i].sent);
        ngx_queue_init(&f->qc.send_ctx[i].sending);
    }
    context(f)->level = NGX_QUIC_ENCRYPTION_APPLICATION;
    lookup = &f->qs;
    fail_allocation = 0;
    close_result = NGX_OK;
}

static void seed(struct fixture *f, size_t length)
{
    ngx_buf_t b;
    ngx_chain_t in;
    memset(&b, 0, sizeof(b));
    b.memory = 1;
    b.pos = payload;
    b.last = payload + length;
    in.buf = &b;
    in.next = NULL;
    CHECK(length <= sizeof(payload));
    CHECK(ngx_quic_stream_send_chain(&f->child, &in, 0) == NULL);
    CHECK(b.pos == b.last && queued(&context(f)->frames) == 1);
    CHECK(tail(f)->type == NGX_QUIC_FT_STREAM);
    CHECK(tail(f)->u.stream.length == length && !tail(f)->u.stream.fin);
    CHECK(!tail(f)->pkt_need_ack && f->qc.push.posted);
    unpost(&f->qc.push);
}

/* Independent minimal RFC 9000 decoder, no nginx wire helpers. */
struct decoded {
    uint64_t id, offset, length;
    unsigned fin;
    const unsigned char *payload;
};
static int read_int(const unsigned char **p, const unsigned char *end,
    uint64_t *value)
{
    size_t n, i;
    if (*p == end) { return 0; }
    n = (size_t) 1 << (**p >> 6);
    if ((size_t) (end - *p) < n) { return 0; }
    *value = *(*p)++ & 63;
    for (i = 1; i < n; i++) { *value = (*value << 8) | *(*p)++; }
    return 1;
}
static int decode(const unsigned char *bytes, size_t n, struct decoded *d)
{
    const unsigned char *p = bytes, *end = bytes + n;
    uint64_t type;
    memset(d, 0, sizeof(*d));
    if (!read_int(&p, end, &type) || type < 8 || type > 15
        || !read_int(&p, end, &d->id)) { return 0; }
    if ((type & 4) && !read_int(&p, end, &d->offset)) { return 0; }
    if (type & 2) {
        if (!read_int(&p, end, &d->length)) { return 0; }
    } else { d->length = end - p; }
    if (d->length > (uint64_t) (end - p)
        || d->offset > MAX62 - d->length) { return 0; }
    d->fin = !!(type & 1);
    d->payload = p;
    return p + d->length == end;
}

static size_t decoder_checks, malformed_checks;
static unsigned char selected_wire[2][2304];
static size_t selected_size[2], selected_count;
static int capture_vector;
static size_t check_frame(ngx_quic_frame_t *frame, size_t payload_start)
{
    unsigned char wire[2304];
    struct decoded d;
    ssize_t n, written;
    size_t i;
    ngx_quic_frame_t before = *frame;
    memset(wire, 0xa5, sizeof(wire));
    n = ngx_quic_create_frame(NULL, frame);
    CHECK(n >= 3 && n < 2200 && n == frame->len);
    CHECK(!memcmp(&before, frame, sizeof(before)));
    written = ngx_quic_create_frame(wire + 8, frame);
    CHECK(written == n && !memcmp(&before, frame, sizeof(before)));
    for (i = 0; i < 8; i++) { CHECK(wire[i] == 0xa5); }
    for (i = 8 + n; i < sizeof(wire); i++) { CHECK(wire[i] == 0xa5); }
    CHECK(decode(wire + 8, n, &d));
    CHECK(d.id == frame->u.stream.stream_id
          && d.offset == frame->u.stream.offset
          && d.length == frame->u.stream.length
          && d.fin == frame->u.stream.fin);
    CHECK(!memcmp(d.payload, payload + payload_start, d.length));
    if (capture_vector) {
        CHECK(selected_count < 2);
        memcpy(selected_wire[selected_count], wire + 8, n);
        selected_size[selected_count++] = n;
    }
    CHECK(!decode(wire + 8, n - 1, &d));
    wire[8 + n] = 0x55;
    CHECK(!decode(wire + 8, n + 1, &d));
    malformed_checks += 2;
    decoder_checks++;
    return n;
}

static size_t positive_cases, fallback_cases, state_cases, ack_cases;
static size_t split_cases, split_fragments, requeue_cases, allocation_cases;
static size_t component_bytes, explicit_fin_frames;

static void positive(void)
{
    const uint64_t starts[] = {0, 63, 16383, 1073741823};
    const uint64_t ids[] = {0, 64};
    const size_t lengths[] = {1, 63, 64, 437, 1024};
    size_t a, b, c;
    for (a = 0; a < 4; a++) {
        for (b = 0; b < 2; b++) {
            for (c = 0; c < 5; c++) {
                struct fixture f;
                ngx_quic_frame_t *original;
                ngx_quic_frame_t before, after;
                ngx_buf_t before_buffer;
                ngx_queue_t *q;
                uint64_t sent, offset, total_sent, total_offset;
                size_t allocations_before, final_count = 0;
                initialize(&f, starts[a], ids[b]);
                seed(&f, lengths[c]);
                original = tail(&f);
                before = *original;
                before_buffer = *original->data->buf;
                sent = f.qs.sent; offset = f.qs.send_offset;
                total_sent = f.qc.streams.sent;
                total_offset = f.qc.streams.send_offset;
                allocations_before = allocation_attempts;
                CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
                CHECK(queued(&context(&f)->frames) == (TEST_CANDIDATE ? 1 : 2));
                CHECK(original->u.stream.fin == TEST_CANDIDATE);
                after = *original;
                after.queue = before.queue;
                after.u.stream.fin = before.u.stream.fin;
                CHECK(!memcmp(&after, &before, sizeof(before)));
                CHECK(!memcmp(original->data->buf, &before_buffer, sizeof(before_buffer)));
                CHECK(f.qs.send_state == NGX_QUIC_STREAM_SEND_DATA_SENT);
                CHECK(f.qs.send_final_size == sent && f.qs.sent == sent
                      && f.qs.send_offset == offset && f.qc.streams.sent == total_sent
                      && f.qc.streams.send_offset == total_offset);
                CHECK(f.qc.push.posted);
                if (TEST_CANDIDATE) { CHECK(allocation_attempts == allocations_before); }
                capture_vector = a == 0 && b == 0 && lengths[c] == 437;
                for (q = ngx_queue_head(&context(&f)->frames);
                     q != ngx_queue_sentinel(&context(&f)->frames);
                     q = ngx_queue_next(q))
                {
                    ngx_quic_frame_t *frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
                    component_bytes += check_frame(frame, frame == original ? 0 : lengths[c]);
                    if (frame->u.stream.fin) { final_count++; }
                    if (!frame->u.stream.length && frame->u.stream.fin) { explicit_fin_frames++; }
                }
                capture_vector = 0;
                CHECK(final_count == 1);
                allocations_before = allocation_attempts;
                CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
                CHECK(allocation_attempts == allocations_before);
                positive_cases++;
                unpost(&f.qc.push);
            }
        }
    }
}

static void fallbacks(void)
{
    unsigned variant;
    for (variant = 0; variant < 12; variant++) {
        struct fixture f;
        ngx_quic_frame_t *original;
        ngx_quic_frame_t before;
        initialize(&f, 0, 0);
        seed(&f, 437);
        original = tail(&f);
        switch (variant) {
        case 0: original->type = NGX_QUIC_FT_PING; break;
        case 1: original->level = NGX_QUIC_ENCRYPTION_HANDSHAKE; break;
        case 2: original->pkt_need_ack = 1; original->pnum = 0; break;
        case 3: original->u.stream.stream_id = 4; break;
        case 4: original->u.stream.length = 0; break;
        case 5: original->u.stream.off = 0; break;
        case 6: original->u.stream.len = 0; break;
        case 7: original->u.stream.fin = 1; break;
        case 8: original->u.stream.offset = 438; break;
        case 9: original->u.stream.offset = 1; break;
        case 10: f.qc.closing = 1; break;
        case 11: ngx_queue_remove(&original->queue); break;
        }
        before = *original;
        CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
        {
            ngx_quic_frame_t after = *original;
            after.queue = before.queue;  /* Insertion changes neighbor links only. */
            CHECK(!memcmp(&after, &before, sizeof(before)));
        }
        CHECK(tail(&f) != original && tail(&f)->u.stream.fin
              && tail(&f)->u.stream.offset == 437 && !tail(&f)->u.stream.length);
        CHECK(f.qc.push.posted == !f.qc.closing);
        CHECK(f.qs.send_offset == 437 && f.qs.sent == 437
              && f.qc.streams.send_offset == 437);
        check_frame(tail(&f), 437);
        fallback_cases++;
        unpost(&f.qc.push);
    }
}

static void states(void)
{
    const ngx_uint_t excluded[] = {NGX_QUIC_STREAM_SEND_DATA_SENT,
        NGX_QUIC_STREAM_SEND_DATA_RECVD, NGX_QUIC_STREAM_SEND_RESET_SENT,
        NGX_QUIC_STREAM_SEND_RESET_RECVD};
    size_t i;
    for (i = 0; i < 4; i++) {
        struct fixture f;
        initialize(&f, 0, 0);
        seed(&f, 437);
        f.qs.send_state = excluded[i];
        CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
        CHECK(queued(&context(&f)->frames) == 1 && !tail(&f)->u.stream.fin);
        CHECK(f.qs.send_state == excluded[i] && !f.qc.push.posted);
        state_cases++;
    }
    for (i = 0; i < 4; i++) {
        struct fixture f;
        size_t previous_close = close_calls;
        initialize(&f, 0, 0);
        seed(&f, 437);
        if (i == 0) {
            f.qs.send_max_data = f.qs.send_offset;
            f.qc.streams.send_max_data = f.qc.streams.send_offset;
        }
        if (i == 1 || i == 2) {
            f.qs.connection = NULL;
            close_result = i == 2 ? NGX_ERROR : NGX_OK;
        }
        CHECK(ngx_quic_shutdown_stream_send(&f.child)
              == (i == 2 ? NGX_ERROR : NGX_OK));
        CHECK(close_calls - previous_close == (size_t) (i == 1 || i == 2));
        CHECK(queued(&context(&f)->frames) == (TEST_CANDIDATE ? 1 : 2));
        CHECK(f.qs.sent == 437 && f.qs.send_offset == 437 && f.qc.push.posted);
        unpost(&f.qc.push);
        if (i == 3) {
            ngx_queue_t *q;
            CHECK(ngx_quic_do_reset_stream(&f.qs, 1) == NGX_OK);
            CHECK(f.qs.send_state == NGX_QUIC_STREAM_SEND_RESET_SENT);
            CHECK(tail(&f)->type == NGX_QUIC_FT_RESET_STREAM);
            CHECK(tail(&f)->u.reset_stream.final_size == 437);
            CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
            CHECK(f.qs.send_state == NGX_QUIC_STREAM_SEND_RESET_SENT);
            for (q = ngx_queue_head(&context(&f)->frames);
                 q != ngx_queue_sentinel(&context(&f)->frames); q = ngx_queue_next(q))
            {
                ngx_quic_frame_t *frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
                if (frame->type == NGX_QUIC_FT_STREAM) {
                    ngx_quic_handle_stream_ack(&f.parent, frame);
                }
            }
            CHECK(f.qs.acked == f.qs.sent && f.qs.fin_acked
                  && f.qs.send_state == NGX_QUIC_STREAM_SEND_RESET_SENT);
            ngx_quic_handle_stream_ack(&f.parent, tail(&f));
            CHECK(f.qs.send_state == NGX_QUIC_STREAM_SEND_RESET_RECVD);
            ack_cases++;
            unpost(&f.qc.push);
        }
        state_cases++;
    }
}

static void credit_and_empty(void)
{
    struct fixture f;
    ngx_buf_t b;
    ngx_chain_t in;
    ngx_quic_frame_t *original;
    initialize(&f, 0, 0);
    CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
    CHECK(queued(&context(&f)->frames) == 1 && tail(&f)->u.stream.fin
          && !tail(&f)->u.stream.length && !tail(&f)->u.stream.offset);
    check_frame(tail(&f), 0);
    unpost(&f.qc.push);
    state_cases++;

    initialize(&f, 0, 0);
    seed(&f, 437);
    original = tail(&f);
    f.qs.send_max_data = f.qs.send_offset;
    f.qc.streams.send_max_data = f.qc.streams.send_offset;
    memset(&b, 0, sizeof(b));
    b.memory = 1;
    b.pos = payload + 437;
    b.last = payload + 537;
    in.buf = &b; in.next = NULL;
    CHECK(ngx_quic_stream_send_chain(&f.child, &in, 0) == NULL);
    CHECK(f.qs.sent == 537 && f.qs.send_offset == 437);
    CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
    CHECK(f.qs.send_state == NGX_QUIC_STREAM_SEND_SEND
          && f.qs.send_final_size == 537 && !original->u.stream.fin
          && queued(&context(&f)->frames) == 1);
    f.qs.send_max_data = 65536;
    f.qc.streams.send_max_data = 65536;
    CHECK(ngx_quic_stream_flush(&f.qs) == NGX_OK);
    CHECK(queued(&context(&f)->frames) == 2 && !original->u.stream.fin);
    CHECK(tail(&f)->u.stream.length == 100 && tail(&f)->u.stream.fin
          && tail(&f)->u.stream.offset == 437);
    CHECK(f.qs.sent == 537 && f.qs.send_offset == 537
          && f.qc.streams.sent == 537 && f.qc.streams.send_offset == 537);
    check_frame(original, 0); check_frame(tail(&f), 437);
    unpost(&f.qc.push);
    state_cases++;

    initialize(&f, 0, 0);
    seed(&f, 437);
    ngx_post_event(&f.qc.push, &ngx_posted_events);
    CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
    CHECK(f.qc.push.posted && queued(&ngx_posted_events) == 1);
    unpost(&f.qc.push);
    state_cases++;
}

static void serialized_tail(unsigned lost)
{
    struct fixture f;
    ngx_quic_frame_t *original;
    uint64_t packet_numbers[NGX_QUIC_SEND_CTX_LAST] = {0, 0, 0};
    size_t previous;
    initialize(&f, 0, 0);
    seed(&f, 437);
    original = tail(&f);
    /* Exact output source sets this before frames leave the unsent queue.
     * Encryption/socket execution is outside this component harness. */
    original->pkt_need_ack = 1;
    original->pnum = 0;
    ngx_queue_remove(&original->queue);
    if (lost) {
        ngx_queue_insert_tail(&context(&f)->sent, &original->queue);
        previous = congestion_calls;
        ngx_quic_resend_frames(&f.parent, context(&f));
        CHECK(congestion_calls == previous + 1);
    } else {
        ngx_queue_insert_tail(&context(&f)->sending, &original->queue);
        context(&f)->pnum = 1;
        previous = idle_calls;
        ngx_quic_revert_send(&f.parent, packet_numbers);
        CHECK(context(&f)->pnum == 0 && idle_calls == previous + 1);
    }
    CHECK(tail(&f) == original && original->pkt_need_ack);
    unpost(&f.qc.push);
    CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
    CHECK(queued(&context(&f)->frames) == 2 && !original->u.stream.fin);
    CHECK(tail(&f)->u.stream.fin && !tail(&f)->u.stream.length);
    CHECK(f.qc.push.posted);
    unpost(&f.qc.push);
    requeue_cases++;
}

static void split_and_ack(void)
{
    const size_t budgets[] = {7, 8, 9, 66, 67, 68, 130, 255};
    size_t i, order;
    for (order = 0; order < 2; order++) {
        for (i = 0; i < 8; i++) {
            struct fixture f;
            ngx_queue_t *q;
            size_t total = 0, final_count = 0, count = 0;
            initialize(&f, 0, 0);
            seed(&f, 1024);
            CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
            for (q = ngx_queue_head(&context(&f)->frames);
                 q != ngx_queue_sentinel(&context(&f)->frames); q = ngx_queue_next(q))
            {
                ngx_quic_frame_t *frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
                ngx_int_t rc = ngx_quic_split_frame(&f.parent, frame, budgets[i]);
                CHECK(rc == NGX_OK && (size_t) frame->len <= budgets[i]);
                CHECK(frame->u.stream.offset == total && frame->u.stream.off);
                CHECK(frame->u.stream.fin
                      == (ngx_queue_next(q) == ngx_queue_sentinel(&context(&f)->frames)));
                check_frame(frame, total);
                total += frame->u.stream.length;
                final_count += frame->u.stream.fin;
                count++;
            }
            CHECK(total == 1024 && final_count == 1 && count > 1);
            /* Dispatch the exact ACK handler once for every actual split frame. */
            if (order) {
                ngx_quic_handle_stream_ack(&f.parent, tail(&f));
                CHECK(f.qs.fin_acked && f.qs.acked < f.qs.sent
                      && f.qs.send_state == NGX_QUIC_STREAM_SEND_DATA_SENT);
            }
            for (q = ngx_queue_head(&context(&f)->frames);
                 q != ngx_queue_sentinel(&context(&f)->frames); q = ngx_queue_next(q))
            {
                ngx_quic_frame_t *frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
                if (order && frame == tail(&f)) { continue; }
                ngx_quic_handle_stream_ack(&f.parent, frame);
            }
            CHECK(f.qs.acked == f.qs.sent && f.qs.sent == 1024
                  && f.qs.fin_acked && f.qs.send_state == NGX_QUIC_STREAM_SEND_DATA_RECVD);
            CHECK(f.qc.streams.send_offset == 1024 && f.qc.streams.sent == 1024);
            unpost(&f.qc.push);
            unpost(&f.write_event);
            split_cases++; split_fragments += count; ack_cases++;
        }
    }
}

static void lost_final(void)
{
    struct fixture f;
    ngx_queue_t *q;
    size_t expected, finals = 0, total = 0, calls = congestion_calls;
    initialize(&f, 0, 0);
    seed(&f, 437);
    CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
    expected = queued(&context(&f)->frames);
    while (!ngx_queue_empty(&context(&f)->frames)) {
        q = ngx_queue_head(&context(&f)->frames);
        ngx_quic_frame_t *frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
        frame->pkt_need_ack = 1;
        frame->pnum = 0;
        ngx_queue_remove(q);
        ngx_queue_insert_tail(&context(&f)->sent, q);
    }
    ngx_quic_resend_frames(&f.parent, context(&f));
    CHECK(congestion_calls == calls + 1 && ngx_queue_empty(&context(&f)->sent));
    CHECK(queued(&context(&f)->frames) == expected);
    for (q = ngx_queue_head(&context(&f)->frames);
         q != ngx_queue_sentinel(&context(&f)->frames); q = ngx_queue_next(q))
    {
        ngx_quic_frame_t *frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
        CHECK(frame->pkt_need_ack && frame->u.stream.offset == total);
        check_frame(frame, total);
        total += frame->u.stream.length;
        finals += frame->u.stream.fin;
        ngx_quic_handle_stream_ack(&f.parent, frame);
    }
    CHECK(total == 437 && finals == 1 && f.qs.acked == 437 && f.qs.fin_acked
          && f.qs.send_state == NGX_QUIC_STREAM_SEND_DATA_RECVD);
    unpost(&f.qc.push);
    unpost(&f.write_event);
    requeue_cases++; ack_cases++;
}

static void allocation_controls(void)
{
    unsigned bad_tail;
    for (bad_tail = 0; bad_tail < 2; bad_tail++) {
        struct fixture f;
        ngx_int_t expected = TEST_CANDIDATE && !bad_tail ? NGX_OK : NGX_ERROR;
        initialize(&f, 0, 0);
        seed(&f, 437);
        if (bad_tail) { tail(&f)->pkt_need_ack = 1; }
        fail_allocation = 1;
        CHECK(ngx_quic_shutdown_stream_send(&f.child) == expected);
        fail_allocation = 0;
        CHECK(queued(&context(&f)->frames) == 1);
        CHECK(tail(&f)->u.stream.fin == (TEST_CANDIDATE && !bad_tail));
        CHECK(f.qs.send_offset == 437 && f.qs.sent == 437);
        unpost(&f.qc.push);
        allocation_cases++;
    }
}

static void vectors(const char *path)
{
    FILE *out = fopen(path, "w");
    size_t i, j;
    CHECK(out && selected_count == (TEST_CANDIDATE ? 1 : 2));
    fprintf(out, "{\"scope\":\"Synthetic 437-byte stream, not live data\",\"frames\":[");
    for (i = 0; i < selected_count; i++) {
        fprintf(out, "%s\"", i ? "," : "");
        for (j = 0; j < selected_size[i]; j++) { fprintf(out, "%02x", selected_wire[i][j]); }
        fputc('"', out);
    }
    CHECK(fputs("]}\n", out) >= 0 && fclose(out) == 0);
}

int main(int argc, char **argv)
{
    size_t i;
    for (i = 0; i < sizeof(payload); i++) { payload[i] = (unsigned char) (i * 17 + 5); }
    CHECK(argc == 2);
    positive(); fallbacks(); states(); credit_and_empty();
    serialized_tail(0); serialized_tail(1);
    split_and_ack(); lost_final(); allocation_controls();
    for (i = 0; i < sizeof(payload); i++) { CHECK(payload[i] == (unsigned char) (i * 17 + 5)); }
    vectors(argv[1]);
    printf("{\"positiveCases\":%zu,\"fallbackCases\":%zu,\"stateCases\":%zu,"
           "\"serializedTailCases\":%zu,\"splitCases\":%zu,\"splitFragments\":%zu,"
           "\"ackSequences\":%zu,\"allocationCases\":%zu,\"decoderChecks\":%zu,"
           "\"malformedRejections\":%zu,\"positiveComponentBytes\":%zu,"
           "\"positiveEmptyFinFrames\":%zu,\"nativeOpenSSLApi\":%d}\n",
           positive_cases, fallback_cases, state_cases, requeue_cases, split_cases,
           split_fragments, ack_cases, allocation_cases, decoder_checks,
           malformed_checks, component_bytes, explicit_fin_frames,
           (int) NGX_QUIC_OPENSSL_API);
    for (i = 0; i < nalloc; i++) { free(allocations[i]); }
    return 0;
}
