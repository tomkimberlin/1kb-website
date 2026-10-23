/* Exercise the actual configured nginx serializer, without copied nginx types
 * or helpers. Synthetic public values only; no sockets or secret material. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ngx_event_quic_transport.c>

#define CHECK(x) do { if (!(x)) { \
    fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #x); exit(1); \
} } while (0)

struct entry { uint64_t id; size_t length; const unsigned char *data; };
struct decoded { size_t count; struct entry entries[32]; };

/* Independent RFC 9000 reader: no nginx wire helpers or parameter macros. */
static int read_integer(const unsigned char **p, const unsigned char *end,
    uint64_t *value)
{
    size_t i, length;
    if (*p == end) return 0;
    length = (size_t) 1 << (**p >> 6);
    if ((size_t) (end - *p) < length) return 0;
    *value = *(*p)++ & 0x3f;
    for (i = 1; i < length; i++) *value = (*value << 8) | *(*p)++;
    return 1;
}

static int parse(const unsigned char *data, size_t length, struct decoded *out)
{
    const unsigned char *p = data, *end = data + length;
    uint64_t id, size;
    size_t i;
    memset(out, 0, sizeof(*out));
    while (p != end) {
        if (!read_integer(&p, end, &id) || !read_integer(&p, end, &size)
            || size > (uint64_t) (end - p) || out->count == 32) return 0;
        for (i = 0; i < out->count; i++)
            if (out->entries[i].id == id) return 0;
        out->entries[out->count++] = (struct entry){id, (size_t) size, p};
        p += size;
    }
    return 1;
}

static const struct entry *find(const struct decoded *decoded, uint64_t id)
{
    size_t i;
    for (i = 0; i < decoded->count; i++)
        if (decoded->entries[i].id == id) return &decoded->entries[i];
    return NULL;
}

static uint64_t integer(const struct decoded *decoded, uint64_t id,
    uint64_t absent_default)
{
    const struct entry *entry = find(decoded, id);
    const unsigned char *p, *end;
    uint64_t value;
    if (!entry) return absent_default;
    p = entry->data; end = p + entry->length;
    CHECK(read_integer(&p, end, &value) && p == end);
    return value;
}

static ngx_quic_tp_t parameters(uint64_t delay, uint64_t exponent,
    unsigned variant)
{
    static unsigned char cid[] = {1,2,3,4,5,6,7,8};
    ngx_quic_tp_t tp;
    memset(&tp, 0, sizeof(tp));
    tp.max_idle_timeout = 65000;
    tp.max_ack_delay = delay;
    tp.ack_delay_exponent = exponent;
    tp.max_udp_payload_size = 65527;
    tp.initial_max_data = 131 * 65536;
    tp.initial_max_stream_data_bidi_local = 65536;
    tp.initial_max_stream_data_bidi_remote = 65536;
    tp.initial_max_stream_data_uni = 65536;
    tp.initial_max_streams_bidi = 128;
    tp.initial_max_streams_uni = 3;
    tp.active_connection_id_limit = 2;
    tp.disable_active_migration = variant & 1;
    tp.original_dcid = (ngx_str_t){sizeof(cid),cid};
    tp.initial_scid = (ngx_str_t){sizeof(cid),cid};
    if (variant & 2) tp.retry_scid = (ngx_str_t){sizeof(cid),cid};
    if (variant & 4) tp.initial_max_data = 63;
    if (variant & 8) tp.initial_max_data = 64;
    if (variant & 16) tp.initial_max_data = 16383;
    if (variant & 32) tp.initial_max_data = 16384;
    if (variant & 64) tp.initial_max_data = ((uint64_t)1 << 30);
    return tp;
}

static size_t serialize(ngx_quic_tp_t *tp, unsigned char *out, size_t *context)
{
    ssize_t predicted, actual;
    predicted = ngx_quic_create_transport_params(NULL, NULL, tp, context);
    CHECK(predicted > 0 && predicted < 512);
    memset(out, 0xa5, 512);
    actual = ngx_quic_create_transport_params(out, out + predicted, tp, NULL);
    CHECK(actual == predicted && out[actual] == 0xa5);
    return (size_t) actual;
}

int main(int argc, char **argv)
{
    static const uint64_t settings[][2] = {
        {25,3},{0,3},{24,3},{26,3},{63,3},{64,3},{16383,3},
        {25,0},{25,2},{25,4},{25,20},{0,0},{64,20},{16383,20}
    };
    static const unsigned variants[] = {0,1,2,3,4,8,16,32,64};
    /* Archived prepatch prefix for this public synthetic parameter set. */
    static const unsigned char expected_context[] = {
        0x04,0x04,0x80,0x83,0,0,0x09,0x01,0x03,0x08,0x02,0x40,0x80,
        0x05,0x04,0x80,0x01,0,0,0x06,0x04,0x80,0x01,0,0,
        0x07,0x04,0x80,0x01,0,0,0x01,0x04,0x80,0,0xfd,0xe8,
        0x03,0x04,0x80,0,0xff,0xf7,0x0e,0x01,0x02
    };
    unsigned char out[512], reference[512];
    struct decoded decoded, previous, malformed;
    size_t i,j,k,length,context,reference_context,reference_length,cases=0;
    int baseline = argc == 2 && strcmp(argv[1], "--baseline") == 0;
    CHECK(argc == 1 || baseline);
    for (i=0;i<sizeof(settings)/sizeof(settings[0]);i++) {
        for (j=0;j<sizeof(variants)/sizeof(variants[0]);j++) {
            ngx_quic_tp_t tp = parameters(settings[i][0],settings[i][1],variants[j]);
            ngx_quic_tp_t control = parameters(0,0,variants[j]);
            reference_length=serialize(&control,reference,&reference_context);
            CHECK(parse(reference,reference_length,&previous));
            length=serialize(&tp,out,&context);
            CHECK(context==reference_context && !memcmp(out,reference,context));
            CHECK(parse(out,length,&decoded));
            CHECK(integer(&decoded,0x0b,25)==settings[i][0]);
            CHECK(integer(&decoded,0x0a,3)==settings[i][1]);
            CHECK((find(&decoded,0x0b)!=NULL)==(baseline || settings[i][0]!=25));
            CHECK((find(&decoded,0x0a)!=NULL)==(baseline || settings[i][1]!=3));
            /* Every other field remains byte-for-byte identical to control. */
            for (k=0;k<previous.count;k++) {
                const struct entry *a=&previous.entries[k], *b=find(&decoded,a->id);
                if (a->id==0x0a || a->id==0x0b) continue;
                CHECK(b && a->length==b->length && !memcmp(a->data,b->data,a->length));
            }
            if (variants[j]==0) {
                CHECK(context==sizeof(expected_context));
                CHECK(!memcmp(out,expected_context,sizeof(expected_context)));
            }
            if (i==0 && j==0) CHECK(length==(baseline?90:84));
            CHECK(!parse(out,length-1,&malformed));
            cases++;
        }
    }
    /* Independent parser boundaries, invalid lengths and duplicate rejection. */
    { unsigned char bad[]={0x0a,2,3}; CHECK(!parse(bad,sizeof(bad),&malformed)); }
    { unsigned char bad[]={0x0a,1,3,0x0a,1,3}; CHECK(!parse(bad,sizeof(bad),&malformed)); }
    { unsigned char bad[]={0x40}; CHECK(!parse(bad,sizeof(bad),&malformed)); }
    printf("{\"cases\":%zu,\"default_bytes\":%d,\"parser_negative_controls\":%zu,\"actual_nginx_source\":true,\"saved_context_preserved\":true,\"passed\":true}\n",cases,baseline?90:84,cases+3);
    return 0;
}
