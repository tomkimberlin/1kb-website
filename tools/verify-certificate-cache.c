/* Tests execute the actual loader, using only an archived public certificate. */
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <openssl/ssl.h>
#include <openssl/crypto.h>
#include <brotli/decode.h>
#define CHECK(x) do { if(!(x)){fprintf(stderr,"FAIL %d: %s\n",__LINE__,#x);exit(1);} }while(0)

/* Fail each allocation in the real loader and OpenSSL callees, one at a time.
 * The hook is inactive during setup, assertions and cache resets. */
struct allocation { const char *file; int line, installing; size_t size; };
static struct allocation trace[2048];
static int allocation_active, allocation_calls, allocation_fail, allocation_failed;
static int installing, installation_failed;
static int decoder_calls, decoder_fail;

static int fail_allocation(size_t size, const char *file, int line)
{
    if (!allocation_active) return 0;
    CHECK(allocation_calls < (int)(sizeof(trace) / sizeof(trace[0])));
    trace[allocation_calls++] = (struct allocation){file, line, installing, size};
    if (allocation_calls != allocation_fail) return 0;
    allocation_failed = 1;
    if (installing) installation_failed = 1;
    return 1;
}

static void *test_malloc(size_t size, const char *file, int line)
{
    return fail_allocation(size, file, line) ? NULL : malloc(size);
}

static void *test_realloc(void *memory, size_t size, const char *file, int line)
{
    return fail_allocation(size, file, line) ? NULL : realloc(memory, size);
}

static void test_free(void *memory, const char *file, int line)
{
    (void)file; (void)line;
    free(memory);
}

static BrotliDecoderState *test_decoder_create(brotli_alloc_func alloc,
    brotli_free_func free_func, void *opaque)
{
    if (++decoder_calls == decoder_fail) return NULL;
    return BrotliDecoderCreateInstance(alloc, free_func, opaque);
}

static int test_set1_compressed_cert(SSL_CTX *context, int algorithm,
    unsigned char *data, size_t length, size_t raw_length)
{
    installing = 1;
    int result = SSL_CTX_set1_compressed_cert(context, algorithm, data, length,
                                           raw_length);
    installing = 0;
    return result;
}

static int inject_eintr, short_reads, read_calls;
static ssize_t test_read(int fd, void *buf, size_t n) {
    read_calls++;
    if (inject_eintr) { inject_eintr=0; errno=EINTR; return -1; }
    if (short_reads && n>7) n=7;
    return read(fd,buf,n);
}
#define read test_read
#define BrotliDecoderCreateInstance test_decoder_create
#define SSL_CTX_set1_compressed_cert test_set1_compressed_cert
#include "ngx_http_ssl_brotli_cache.h"
#undef read
#undef BrotliDecoderCreateInstance
#undef SSL_CTX_set1_compressed_cert
#include "ssl/ssl_local.h"
#include <brotli/encode.h>
static SSL_CTX *ctx;
static unsigned char best[65536], *baseline;
static size_t bestlen, baseline_len, rawlen;
static char entry[512];
static void write_entry(const void *p,size_t n) {FILE *f=fopen(entry,"wb");CHECK(f);CHECK(fwrite(p,1,n,f)==n);CHECK(!fclose(f));}
static void check_cache(int installed) {
    OSSL_COMP_CERT *cached=ctx->cert->key->comp_cert[TLSEXT_comp_cert_brotli];
    CHECK(cached && cached->len==(installed?bestlen:baseline_len));
    CHECK(!memcmp(cached->data,installed?best:baseline,cached->len));
}
static void run(const char *name,int wanted) {
    const char *reason=NULL;
    CHECK(SSL_CTX_compress_certs(ctx,TLSEXT_comp_cert_brotli));
    ERR_raise(ERR_LIB_SSL,ERR_R_INTERNAL_ERROR);unsigned long old=ERR_peek_last_error();
    int got=ngx_ssl_cert_cache_load(ctx,"cache",&reason);if(got!=wanted)fprintf(stderr,"case=%s reason=%s\n",name,reason?reason:"missing");CHECK(got==wanted);
    CHECK(ERR_peek_last_error()==old);ERR_clear_error();
    check_cache(wanted);
    printf("{\"case\":\"%s\",\"installed\":%s,\"exact_cache_verified\":true,\"prior_error_preserved\":true}\n",name,got?"true":"false");
}

static void allocation_faults(void)
{
    const char *reason;
    struct allocation sites[2048];
    int count, installed, failures = 0, safe_successes = 0, install_failures = 0;
    write_entry(best,bestlen);
    CHECK(SSL_CTX_compress_certs(ctx,TLSEXT_comp_cert_brotli));
    ERR_clear_error();
    allocation_calls=0; allocation_active=1;
    installed=ngx_ssl_cert_cache_load(ctx,"cache",&reason);
    allocation_active=0;
    CHECK(installed && reason==NULL && ERR_peek_error()==0);
    check_cache(1);
    count=allocation_calls;
    CHECK(count>0);
    memcpy(sites,trace,count*sizeof(*sites));
    for (int preserve=0; preserve<2; preserve++) {
        for (int site=1; site<=count; site++) {
            CHECK(SSL_CTX_compress_certs(ctx,TLSEXT_comp_cert_brotli));
            check_cache(0);
            ERR_clear_error();
            unsigned long first=0, last=0;
            if (preserve) {
                ERR_raise(ERR_LIB_USER,123); first=ERR_peek_last_error();
                CHECK(ERR_set_mark());
                ERR_raise(ERR_LIB_USER,124); last=ERR_peek_last_error();
                CHECK(ERR_set_mark());
            }
            allocation_calls=0; allocation_failed=0; installation_failed=0;
            allocation_fail=site; allocation_active=1;
            installed=ngx_ssl_cert_cache_load(ctx,"cache",&reason);
            allocation_active=0; allocation_fail=0;
            CHECK(allocation_failed);
            CHECK(trace[site-1].line==sites[site-1].line);
            CHECK(!strcmp(trace[site-1].file,sites[site-1].file));
            CHECK(trace[site-1].size==sites[site-1].size);
            check_cache(installed);
            CHECK((installed && reason==NULL) || (!installed && reason!=NULL));
            CHECK(ERR_peek_error()==first && ERR_peek_last_error()==last);
            if (preserve) {
                CHECK(ERR_pop_to_mark() && ERR_peek_last_error()==last);
                CHECK(ERR_pop_to_mark() && ERR_peek_last_error()==first);
                CHECK(ERR_get_error()==first);
            }
            CHECK(ERR_get_error()==0);
            if (installed) safe_successes++; else failures++;
            install_failures+=installation_failed;
            CHECK(ngx_ssl_cert_cache_load(ctx,"cache",&reason) && reason==NULL);
            check_cache(1);
            CHECK(ERR_peek_error()==0);
            printf("{\"case\":\"allocation-failure\",\"site\":%d,\"prior_errors\":%s,\"fallback\":%s,\"install_allocation\":%s,\"retry_passed\":true,\"source\":\"%s:%d\",\"bytes\":%zu}\n",
                   site,preserve?"true":"false",installed?"false":"true",
                   sites[site-1].installing?"true":"false",
                   sites[site-1].file,sites[site-1].line,sites[site-1].size);
        }
    }
    CHECK(install_failures>=4); /* Candidate data and object, both queue modes. */
    for (int which=1; which<=2; which++) {
        CHECK(SSL_CTX_compress_certs(ctx,TLSEXT_comp_cert_brotli));
        decoder_calls=0; decoder_fail=which;
        CHECK(!ngx_ssl_cert_cache_load(ctx,"cache",&reason));
        decoder_fail=0;
        CHECK(decoder_calls==which && reason!=NULL && ERR_peek_error()==0);
        check_cache(0);
        CHECK(ngx_ssl_cert_cache_load(ctx,"cache",&reason));
        check_cache(1);
        printf("{\"case\":\"decoder-allocation-failure\",\"decoder\":%d,\"fallback\":true,\"retry_passed\":true}\n",which);
    }
    printf("{\"allocation_sites\":%d,\"fault_checks\":%d,\"baseline_fallbacks\":%d,\"safe_candidate_successes\":%d,\"failed_install_allocations\":%d,\"decoder_fault_checks\":2}\n",
           count,count*2,failures,safe_successes,install_failures);
}

int main(int argc, char **argv) {
    CHECK(argc==3);
    CHECK(CRYPTO_set_mem_functions(test_malloc,test_realloc,test_free));
    ctx=SSL_CTX_new(TLS_server_method());CHECK(ctx);
    CHECK(!ngx_ssl_cert_cache_single(ctx));
    CHECK(SSL_CTX_use_certificate_chain_file(ctx,argv[1]));
    baseline_len=SSL_CTX_get1_compressed_cert(ctx,TLSEXT_comp_cert_brotli,&baseline,&rawlen);CHECK(baseline_len>0&&rawlen<=65536);
    unsigned char raw[65536],digest[32];unsigned int dl=0;
    CHECK(ngx_ssl_cert_cache_decode(baseline,baseline_len,raw,rawlen));CHECK(EVP_Digest(raw,rawlen,digest,&dl,EVP_sha256(),NULL)&&dl==32);
    memcpy(entry,"cache/",6);for(unsigned i=0;i<32;i++)snprintf(entry+6+2*i,3,"%02x",digest[i]);strcat(entry,".br");
    mkdir("cache",0700);unlink(entry);
    FILE *f=fopen(argv[2],"rb");CHECK(f);bestlen=fread(best,1,sizeof(best),f);CHECK(feof(f)&&bestlen>0&&bestlen<baseline_len);fclose(f);
    run("missing",0);
    write_entry(best,bestlen);run("valid-candidate",1);
    inject_eintr=1;short_reads=1;read_calls=0;run("eintr-and-short-reads",1);CHECK(!inject_eintr&&read_calls>2);short_reads=0;
    write_entry(best,bestlen-1);run("truncated",0);
    unsigned char appended[65536];memcpy(appended,best,bestlen);appended[bestlen]=0;write_entry(appended,bestlen+1);run("trailing-junk",0);
    write_entry(baseline,baseline_len);run("non-improving",0);
    write_entry("",0);run("empty",0);
    write_entry("\xff",1);run("malformed",0);
    memset(raw,0,rawlen);size_t n=sizeof(appended);CHECK(BrotliEncoderCompress(5,22,BROTLI_MODE_GENERIC,rawlen,raw,&n,appended));CHECK(n<baseline_len);write_entry(appended,n);run("stale-exact-length-body",0);
    n=sizeof(appended);CHECK(BrotliEncoderCompress(5,22,BROTLI_MODE_GENERIC,rawlen-1,raw,&n,appended));write_entry(appended,n);run("wrong-output-length",0);
    unlink(entry);CHECK(!mkdir(entry,0700));run("directory-instead-of-file",0);CHECK(!rmdir(entry));
    CHECK(!mkfifo(entry,0600));run("fifo-without-writer",0);CHECK(!unlink(entry));
    allocation_faults();
    OPENSSL_free(baseline);SSL_CTX_free(ctx);return 0;
}
