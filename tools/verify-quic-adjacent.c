/* Adjacent STREAM component gate. Reuse configured types, exact source,
 * allocator scaffolding and independent decoder from the separate FIN gate.
 * Packet selection/history marking is modeled; no socket/crypto/timing claim. */
#include <ngx_event_quic_connection.h>
static ngx_chain_t *adjacent_read_buffer(ngx_connection_t *c,
    ngx_quic_buffer_t *qb, uint64_t limit);
#ifndef QUIC_ADJACENT_SCAFFOLD
#error The configured gate must name the unchanged FIN scaffold
#endif
#define main historical_fin_main
#include QUIC_ADJACENT_SCAFFOLD
#undef main

static unsigned bad_new_view;
static ngx_buf_t *changed_view;
static ngx_buf_t saved_view;
static size_t joins, guards, ownership_orders, third_writes, flow_cases;
static size_t split_orders, history_cases, suffix_orders, wakeups;

/* Only malformed-view tests change this otherwise transparent seam. The
 * extractor macro changes calls, never the actual read-buffer definition. */
static ngx_chain_t *adjacent_read_buffer(ngx_connection_t *c,
    ngx_quic_buffer_t *qb, uint64_t limit)
{
    ngx_chain_t *out = ngx_quic_read_buffer(c, qb, limit);
    if (bad_new_view && out && out != NGX_CHAIN_ERROR) {
        changed_view = out->buf;
        saved_view = *changed_view;
        switch (bad_new_view) {
        case 1: changed_view->last--; break;
        case 2: changed_view->sync = 1; break;
        case 3: changed_view->memory = changed_view->temporary = 0; break;
        case 4: changed_view->last = changed_view->pos; break;
        }
    }
    return out;
}

static void write_bytes(struct fixture *f, size_t start, size_t length)
{
    ngx_buf_t b;
    ngx_chain_t in;
    CHECK(start + length <= sizeof(payload));
    memset(&b, 0, sizeof(b));
    b.memory = 1; b.pos = payload + start; b.last = b.pos + length;
    in.buf = &b; in.next = NULL;
    CHECK(ngx_quic_stream_send_chain(&f->child, &in, 0) == NULL);
    CHECK(b.pos == b.last);
}

static void release(struct fixture *f)
{
    ngx_quic_free_frames(&f->parent, &context(f)->frames);
    ngx_quic_free_frames(&f->parent, &context(f)->sending);
    ngx_quic_free_frames(&f->parent, &context(f)->sent);
    ngx_quic_free_buffer(&f->parent, &f->qs.send);
    unpost(&f->qc.push); unpost(&f->write_event);
}

static void counters(struct fixture *f, uint64_t end)
{
    CHECK(f->qs.sent == end && f->qs.send_offset == end
          && f->qc.streams.sent == end && f->qc.streams.send_offset == end);
}

static void component(unsigned candidate)
{
    struct fixture f;
    ngx_queue_t *q;
    size_t bytes = 0, total = 0;
    initialize(&f, 0, 3); seed(&f, 1); write_bytes(&f, 1, 8);
    CHECK(queued(&context(&f)->frames) == (candidate ? 1 : 2));
    CHECK(f.qc.nframes == (candidate ? 1 : 2));
    for (q = ngx_queue_head(&context(&f)->frames);
         q != ngx_queue_sentinel(&context(&f)->frames); q = ngx_queue_next(q))
    {
        ngx_quic_frame_t *frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
        bytes += check_frame(frame, total); total += frame->u.stream.length;
    }
    CHECK(total == 9 && bytes == (candidate ? 12 : 16)); counters(&f, 9);
    printf("{\"scope\":\"synthetic explicit STREAM component\","
           "\"payloadBytes\":9,\"headerBytes\":%zu,\"allocatedFrames\":%ju,"
           "\"candidate\":%s}\n", bytes - total, (uintmax_t) f.qc.nframes,
           candidate ? "true" : "false");
    release(&f);
}

static void join_matrix(void)
{
    const uint64_t starts[] = {0, 63, 16383, MAX62 - 128};
    const uint64_t ids[] = {3, 64, 16384};
    const size_t pairs[][2] = {{1, 8}, {31, 32}, {32, 32}, {63, 1}, {1, 63}};
    size_t a, b, c;
    for (a = 0; a < 4; a++) for (b = 0; b < 3; b++) for (c = 0; c < 5; c++) {
        struct fixture f;
        ngx_quic_frame_t *frame, before, after;
        ngx_buf_t view, current;
        size_t total = pairs[c][0] + pairs[c][1];
        initialize(&f, starts[a], ids[b]);
        if (a == 3) { f.qs.send_max_data = f.qc.streams.send_max_data = MAX62; }
        seed(&f, pairs[c][0]); frame = tail(&f); before = *frame;
        view = *frame->data->buf;
        write_bytes(&f, pairs[c][0], pairs[c][1]);
        CHECK(queued(&context(&f)->frames) == 1 && tail(&f) == frame);
        CHECK(frame->data->next && !frame->data->next->next);
        CHECK(frame->data->buf != frame->data->next->buf);
        CHECK(ngx_quic_buf_refs(frame->data->buf) == 3);
        current = *frame->data->buf; current.num = view.num;
        CHECK(!memcmp(&current, &view, sizeof(view)));
        after = *frame; after.u.stream.length = before.u.stream.length;
        after.len = before.len;
        CHECK(!memcmp(&after, &before, sizeof(before)));
        CHECK(frame->u.stream.length == total && f.qc.nframes == 1);
        counters(&f, starts[a] + total); check_frame(frame, 0);
        CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
        CHECK(tail(&f) == frame && frame->u.stream.fin && f.qc.nframes == 1);
        check_frame(frame, 0); release(&f); joins++;
    }
}

static void ownership(void)
{
    unsigned order;
    for (order = 0; order < 2; order++) {
        struct fixture f;
        ngx_quic_frame_t *frame;
        ngx_buf_t *shared, *hole;
        initialize(&f, 0, 3); seed(&f, 1); frame = tail(&f);
        shared = frame->data->buf->shadow; CHECK(shared->num == 2);
        write_bytes(&f, 1, 8); CHECK(shared->num == 3);
        hole = f.qs.send.chain->buf;
        CHECK(hole->sync && hole->shadow == shared && !f.qs.send.last_chain);
        CHECK(frame->data->buf->last == frame->data->next->buf->pos
              && frame->data->next->buf->last == hole->pos);
        ngx_queue_remove(&frame->queue);
        if (order == 0) {
            ngx_quic_free_frame(&f.parent, frame);
            CHECK(shared->num == 1 && !f.qc.free_bufs);
            ngx_quic_free_buffer(&f.parent, &f.qs.send);
        } else {
            ngx_quic_free_buffer(&f.parent, &f.qs.send);
            CHECK(shared->num == 2 && !f.qc.free_bufs);
            ngx_quic_free_frame(&f.parent, frame);
        }
        CHECK(!shared->num && f.qc.free_bufs == shared && !shared->shadow);
        memset(&f.qs.send, 0, sizeof(f.qs.send));
        f.qs.send.offset = f.qs.send_offset; f.qs.acked = f.qs.sent;
        write_bytes(&f, 9, 2);
        CHECK(tail(&f)->data->buf->shadow == shared && shared->num == 2);
        check_frame(tail(&f), 9); release(&f);
        CHECK(!shared->num && f.qc.free_bufs == shared && !shared->shadow);
        ownership_orders++;
    }
}

static void fallback_matrix(void)
{
    unsigned variant;
    for (variant = 0; variant < 25; variant++) {
        struct fixture f;
        ngx_quic_frame_t *frame, valid, damaged, after;
        ngx_buf_t *valid_buffer;
        ngx_buf_t valid_view, damaged_view, current;
        ngx_queue_t queue;
        initialize(&f, variant == 13 ? MAX62 - 1 : 0, 3);
        seed(&f, 1); frame = tail(&f); valid = *frame;
        valid_buffer = frame->data->buf; valid_view = *valid_buffer;
        switch (variant) {
        case 0: frame->pkt_need_ack = 1; frame->pnum = 0; break;
        case 1: frame->type = NGX_QUIC_FT_PING; break;
        case 2: frame->level = NGX_QUIC_ENCRYPTION_HANDSHAKE; break;
        case 3: frame->u.stream.stream_id = 7; break;
        case 4: frame->u.stream.off = 0; break;
        case 5: frame->u.stream.len = 0; break;
        case 6: frame->u.stream.fin = 1; break;
        case 7: frame->u.stream.offset = 2; break;
        case 8: f.qc.closing = 1; break;
        case 9: f.qs.connection = NULL; break;
        case 10: frame->data->buf->sync = 1; break;
        case 11: frame->data->buf->memory = frame->data->buf->temporary = 0; break;
        case 12: f.qs.send_offset = f.qs.send.offset = 2;
                 frame->u.stream.length = 2; break;
        case 13: f.qs.send_max_data = f.qc.streams.send_max_data = (uint64_t) -1; break;
        case 14: bad_new_view = 1; break;
        case 15: f.qs.send_final_size = 9; break;
        case 16: ngx_queue_remove(&frame->queue); break;
        case 17: frame->data = NULL; break;
        case 18: frame->data->buf = NULL; break;
        case 19: frame->u.stream.length = 0; break;
        case 20: bad_new_view = 2; break;
        case 21: bad_new_view = 3; break;
        case 22: bad_new_view = 4; break;
        case 23: frame->data->buf->last = frame->data->buf->pos; break;
        case 24: f.qs.send_offset = f.qs.send.offset = 2; break;
        }
        damaged = *frame;
        damaged_view = *valid_buffer;
        write_bytes(&f, 1, 8);
        CHECK(queued(&context(&f)->frames) == (variant == 16 ? 1 : 2));
        CHECK(tail(&f) != frame);
        after = *frame; after.queue = damaged.queue;
        CHECK(!memcmp(&after, &damaged, sizeof(after)));
        current = *valid_buffer; current.num = damaged_view.num;
        CHECK(!memcmp(&current, &damaged_view, sizeof(current)));
        if (changed_view) { *changed_view = saved_view; changed_view = NULL; }
        bad_new_view = 0;
        /* Restore deliberately invalid fixtures solely for safe cleanup. */
        queue = frame->queue; *frame = valid; frame->queue = queue;
        frame->data->buf = valid_buffer;
        /* Preserve the ordinary write's shared-reference increment. */
        current = *valid_buffer;
        *valid_buffer = valid_view; valid_buffer->num = current.num;
        if (variant == 16) { ngx_quic_free_frame(&f.parent, frame); }
        release(&f); guards++;
    }
}

static void third_write(void)
{
    struct fixture f;
    ngx_quic_frame_t *first, before, after;
    initialize(&f, 0, 3); seed(&f, 1); write_bytes(&f, 1, 8);
    first = tail(&f); before = *first; write_bytes(&f, 9, 3);
    CHECK(queued(&context(&f)->frames) == 2 && f.qc.nframes == 2);
    after = *first; after.queue = before.queue;
    CHECK(!memcmp(&after, &before, sizeof(after)));
    CHECK(first->data->next && !first->data->next->next);
    CHECK(tail(&f)->u.stream.offset == 9 && tail(&f)->u.stream.length == 3);
    counters(&f, 12); check_frame(first, 0); check_frame(tail(&f), 9);
    release(&f); third_writes++;
}

static void flow_and_ack(void)
{
    unsigned kind;
    for (kind = 0; kind < 2; kind++) {
        struct fixture f;
        initialize(&f, 0, 3); seed(&f, 1);
        if (kind == 0) { f.qs.send_max_data = 1; }
        else { f.qc.streams.send_max_data = 3; }
        write_bytes(&f, 1, 8);
        CHECK(f.qs.sent == 9 && f.qc.streams.sent == 9);
        CHECK(f.qs.send_offset == (kind ? 3 : 1)
              && f.qc.streams.send_offset == f.qs.send_offset);
        f.qs.send_max_data = f.qc.streams.send_max_data = 65536;
        CHECK(ngx_quic_stream_flush(&f.qs) == NGX_OK); counters(&f, 9);
        CHECK(queued(&context(&f)->frames) == (kind ? 2 : 1));
        release(&f); flow_cases++;
    }
    {
        struct fixture f;
        ngx_buf_t b;
        ngx_chain_t in;
        ngx_quic_frame_t *frame;
        initialize(&f, 0, 3); f.conf.stream_buffer_size = 9;
        seed(&f, 1); write_bytes(&f, 1, 8); frame = tail(&f);
        memset(&b, 0, sizeof(b)); b.memory = 1;
        b.pos = payload + 9; b.last = b.pos + 2; in.buf = &b; in.next = NULL;
        CHECK(ngx_quic_stream_send_chain(&f.child, &in, 0) == &in);
        CHECK(b.pos == payload + 9 && !f.write_event.ready && !f.write_event.posted);
        ngx_quic_handle_stream_ack(&f.parent, frame);
        CHECK(f.qs.acked == 9 && f.write_event.ready && f.write_event.posted);
        /* Model only the real dispatcher's following release, after ACK. */
        ngx_queue_remove(&frame->queue); ngx_quic_free_frame(&f.parent, frame);
        CHECK(ngx_quic_stream_send_chain(&f.child, &in, 0) == NULL);
        CHECK(b.pos == b.last); counters(&f, 11);
        CHECK(tail(&f)->u.stream.offset == 9 && tail(&f)->u.stream.length == 2);
        check_frame(tail(&f), 9); release(&f); wakeups++;
    }
}

static void split_and_ack_join(void)
{
    size_t budget, order;
    for (budget = 3; budget <= 11; budget++) for (order = 0; order < 2; order++) {
        struct fixture f;
        ngx_queue_t *q;
        size_t total = 0, finals = 0;
        initialize(&f, 0, 3); seed(&f, 1); write_bytes(&f, 1, 8);
        CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
        if (budget == 3) {
            CHECK(ngx_quic_split_frame(&f.parent, tail(&f), budget) == NGX_DECLINED);
            check_frame(tail(&f), 0); release(&f); split_orders++; continue;
        }
        for (q = ngx_queue_head(&context(&f)->frames);
             q != ngx_queue_sentinel(&context(&f)->frames); q = ngx_queue_next(q))
        {
            ngx_quic_frame_t *frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
            size_t limit = budget;
            ngx_int_t rc = ngx_quic_split_frame(&f.parent, frame, limit);
            if (rc == NGX_DECLINED) {
                CHECK(frame->u.stream.offset > 0
                      && limit <= (size_t) frame->len - frame->u.stream.length);
                limit += 2; rc = ngx_quic_split_frame(&f.parent, frame, limit);
            }
            CHECK(rc == NGX_OK && (size_t) frame->len <= limit);
            CHECK(frame->u.stream.offset == total); check_frame(frame, total);
            total += frame->u.stream.length; finals += frame->u.stream.fin;
        }
        CHECK(total == 9 && finals == 1);
        if (order) { ngx_quic_handle_stream_ack(&f.parent, tail(&f)); }
        for (q = ngx_queue_head(&context(&f)->frames);
             q != ngx_queue_sentinel(&context(&f)->frames); q = ngx_queue_next(q))
        {
            ngx_quic_frame_t *frame = ngx_queue_data(q, ngx_quic_frame_t, queue);
            if (!order || frame != tail(&f)) { ngx_quic_handle_stream_ack(&f.parent, frame); }
        }
        CHECK(f.qs.acked == 9 && f.qs.fin_acked
              && f.qs.send_state == NGX_QUIC_STREAM_SEND_DATA_RECVD);
        counters(&f, 9); release(&f); split_orders++;
    }
}

static void history(void)
{
    unsigned lost;
    for (lost = 0; lost < 2; lost++) {
        struct fixture f;
        ngx_quic_frame_t *frame;
        uint64_t numbers[NGX_QUIC_SEND_CTX_LAST] = {0, 0, 0};
        size_t prior;
        initialize(&f, 0, 3); seed(&f, 1); write_bytes(&f, 1, 8); frame = tail(&f);
        /* Model exact output's history mark/queue move, then use real handlers. */
        frame->pkt_need_ack = 1; frame->pnum = 0; ngx_queue_remove(&frame->queue);
        if (lost) {
            ngx_queue_insert_tail(&context(&f)->sent, &frame->queue); prior = congestion_calls;
            ngx_quic_resend_frames(&f.parent, context(&f)); CHECK(congestion_calls == prior + 1);
        } else {
            ngx_queue_insert_tail(&context(&f)->sending, &frame->queue); context(&f)->pnum = 1;
            prior = idle_calls; ngx_quic_revert_send(&f.parent, numbers);
            CHECK(context(&f)->pnum == 0 && idle_calls == prior + 1);
        }
        CHECK(tail(&f) == frame && frame->pkt_need_ack);
        write_bytes(&f, 9, 3);
        CHECK(queued(&context(&f)->frames) == 2 && frame->u.stream.length == 9);
        counters(&f, 12); check_frame(frame, 0); check_frame(tail(&f), 9);
        release(&f); history_cases++;
    }
}

static void fresh_suffix(void)
{
    unsigned order;
    for (order = 0; order < 2; order++) {
        struct fixture f;
        ngx_quic_frame_t *prefix, *suffix, before;
        ngx_buf_t view, current;
        initialize(&f, 0, 3); seed(&f, 1); write_bytes(&f, 1, 8); prefix = tail(&f);
        CHECK(ngx_quic_split_frame(&f.parent, prefix, 4) == NGX_OK);
        suffix = tail(&f);
        CHECK(prefix != suffix && prefix->u.stream.length == 1
              && suffix->u.stream.offset == 1 && suffix->u.stream.length == 8);
        /* Selection/commit is modeled here; actual split/append/ACK are not. */
        prefix->pkt_need_ack = 1; prefix->pnum = 0; ngx_queue_remove(&prefix->queue);
        ngx_queue_insert_tail(&context(&f)->sent, &prefix->queue);
        before = *prefix; view = *prefix->data->buf;
        write_bytes(&f, 9, 1);
        CHECK(tail(&f) == suffix && suffix->u.stream.length == 9);
        CHECK(suffix->data->next && !suffix->data->next->next);
        CHECK(!memcmp(prefix, &before, sizeof(before)));
        current = *prefix->data->buf; current.num = view.num;
        CHECK(!memcmp(&current, &view, sizeof(view)));
        counters(&f, 10); check_frame(prefix, 0); check_frame(suffix, 1);
        CHECK(ngx_quic_shutdown_stream_send(&f.child) == NGX_OK);
        CHECK(suffix->u.stream.fin && !prefix->u.stream.fin);
        ngx_quic_handle_stream_ack(&f.parent, order ? suffix : prefix);
        CHECK(f.qs.acked == (order ? 9 : 1));
        ngx_quic_handle_stream_ack(&f.parent, order ? prefix : suffix);
        CHECK(f.qs.acked == 10 && f.qs.fin_acked
              && f.qs.send_state == NGX_QUIC_STREAM_SEND_DATA_RECVD);
        release(&f); suffix_orders++;
    }
}

int main(int argc, char **argv)
{
    size_t i;
    for (i = 0; i < sizeof(payload); i++) { payload[i] = (unsigned char) (i * 17 + 5); }
    CHECK(argc == 1 || (argc == 2 && !strcmp(argv[1], "--baseline-component")));
    component(argc == 1);
    if (argc == 1) {
        join_matrix(); ownership(); fallback_matrix(); third_write();
        flow_and_ack(); split_and_ack_join(); history(); fresh_suffix();
        printf("{\"joins\":%zu,\"guardCases\":%zu,\"ownershipOrders\":%zu,"
               "\"thirdWriteFallbacks\":%zu,\"flowCases\":%zu,\"ackWakeups\":%zu,"
               "\"splitCases\":%zu,\"historyCases\":%zu,\"suffixAckOrders\":%zu,"
               "\"decoderChecks\":%zu,\"malformedRejections\":%zu,\"passed\":true}\n",
               joins, guards, ownership_orders, third_writes, flow_cases, wakeups,
               split_orders, history_cases, suffix_orders, decoder_checks, malformed_checks);
    }
    for (i = 0; i < sizeof(payload); i++) { CHECK(payload[i] == (unsigned char) (i * 17 + 5)); }
    for (i = 0; i < nalloc; i++) { free(allocations[i]); }
    return 0;
}
