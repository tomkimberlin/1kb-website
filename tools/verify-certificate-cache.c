/* Tests execute the actual loader, using only an archived public certificate. */
#include <unistd.h>
#include <errno.h>
static int inject_eintr, short_reads, read_calls;
static ssize_t test_read(int fd, void *buf, size_t n) {
    read_calls++;
    if (inject_eintr) { inject_eintr=0; errno=EINTR; return -1; }
    if (short_reads && n>7) n=7;
    return read(fd,buf,n);
}
#define read test_read
#include "ngx_http_ssl_brotli_cache.h"
#undef read
#include "ssl/ssl_local.h"
#include <brotli/encode.h>
#include <stdio.h>
#include <stdlib.h>
#define CHECK(x) do { if(!(x)){fprintf(stderr,"FAIL %d: %s\n",__LINE__,#x);exit(1);} }while(0)
static SSL_CTX *ctx;
static unsigned char best[65536], *baseline;
static size_t bestlen, baseline_len, rawlen;
static char entry[512];
static void write_entry(const void *p,size_t n) {FILE *f=fopen(entry,"wb");CHECK(f);CHECK(fwrite(p,1,n,f)==n);CHECK(!fclose(f));}
static void run(const char *name,int wanted) {
    const char *reason=NULL;
    CHECK(SSL_CTX_compress_certs(ctx,TLSEXT_comp_cert_brotli));
    ERR_raise(ERR_LIB_SSL,ERR_R_INTERNAL_ERROR);unsigned long old=ERR_peek_last_error();
    int got=ngx_ssl_cert_cache_load(ctx,"cache",&reason);if(got!=wanted)fprintf(stderr,"case=%s reason=%s\n",name,reason?reason:"missing");CHECK(got==wanted);
    CHECK(ERR_peek_last_error()==old);ERR_clear_error();
    OSSL_COMP_CERT *cached=ctx->cert->key->comp_cert[TLSEXT_comp_cert_brotli];
    CHECK(cached && cached->len==(wanted?bestlen:baseline_len));
    CHECK(!memcmp(cached->data,wanted?best:baseline,cached->len));
    printf("{\"case\":\"%s\",\"installed\":%s,\"exact_cache_verified\":true,\"prior_error_preserved\":true}\n",name,got?"true":"false");
}
int main(int argc, char **argv) {
    CHECK(argc==3);
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
    OPENSSL_free(baseline);SSL_CTX_free(ctx);return 0;
}
