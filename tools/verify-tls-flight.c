/* Isolated TLS 1.3 BIO-pair regression harness. No sockets or production state. */
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/x509.h>
#include <openssl/ec.h>
#ifdef COALESCE_INTERNAL
#include "ssl/ssl_local.h"
#include "internal/ssl_unwrap.h"
#endif
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(x) do { if (!(x)) { fprintf(stderr,"FAIL line %d: %s\n",__LINE__,#x); ERR_print_errors_fp(stderr); exit(1); } } while (0)
typedef struct { unsigned records, max_record, want_write, handshakes, pending_flight, encrypted_bytes, message_bytes, server_hellos, compressed_certs, alerts; } Stats;
typedef struct { SSL_CTX *cc, *sc; SSL *c, *s; Stats stats; size_t capacity; } Pair;
#ifdef COALESCE_INTERNAL
static SSL *fault_server;
static int fault_kind, fault_fired;
static int fail_alloc(size_t n,const char *file) {
    if(!fault_server||!fault_kind||fault_fired)return 0;
    SSL_CONNECTION *sc=SSL_CONNECTION_FROM_SSL(fault_server);
    OSSL_HANDSHAKE_STATE state=SSL_get_state(fault_server);
    int hit=(fault_kind==1&&state==TLS_ST_SW_ENCRYPTED_EXTENSIONS&&strstr(file,"buffer.c")&&n==sizeof(BUF_MEM))
        ||(fault_kind==2&&state==TLS_ST_SW_ENCRYPTED_EXTENSIONS&&strstr(file,"buffer.c")&&n>=16384)
        ||(fault_kind==3&&state==TLS_ST_SW_CERT_VRFY&&sc->coalesced_flight&&sc->coalesced_flight->length>0);
    if(hit){fault_fired=1;return 1;}return 0;
}
static void *test_malloc(size_t n,const char *file,int line){(void)line;return fail_alloc(n,file)?NULL:malloc(n);}
static void *test_realloc(void *p,size_t n,const char *file,int line){(void)line;return fail_alloc(n,file)?NULL:realloc(p,n);}
static void test_free(void *p,const char *file,int line){(void)file;(void)line;free(p);}
#endif
static void message(int writing,int version,int type,const void *v,size_t len,SSL *ssl,void *arg) {
    Stats *st=arg; const unsigned char *p=v;
    (void)version;(void)ssl;
    if(!writing && type==SSL3_RT_ALERT && len==2)st->alerts++;
    if (!writing && type==SSL3_RT_HEADER && len==5 && p[0]==SSL3_RT_APPLICATION_DATA) {
        unsigned size=((unsigned)p[3]<<8)+p[4]; st->records++; st->encrypted_bytes+=size+5; if(size>st->max_record)st->max_record=size;
    }
    if(!writing && type==SSL3_RT_HANDSHAKE){st->handshakes++;if(len && p[0]==25)st->compressed_certs++;if(len && p[0]==SSL3_MT_SERVER_HELLO)st->server_hellos++;if(len && p[0]!=SSL3_MT_SERVER_HELLO)st->message_bytes+=(unsigned)len;}
}
static void noop(int writing,int version,int type,const void *v,size_t len,SSL *ssl,void *arg) {
    (void)writing;(void)version;(void)type;(void)v;(void)len;(void)ssl;(void)arg;
}
static X509 *certificate(EVP_PKEY **key,size_t pad) {
    EVP_PKEY_CTX *kc=EVP_PKEY_CTX_new_id(EVP_PKEY_EC,NULL); CHECK(kc);
    CHECK(EVP_PKEY_keygen_init(kc)>0); CHECK(EVP_PKEY_CTX_set_ec_paramgen_curve_nid(kc,NID_X9_62_prime256v1)>0);
    CHECK(EVP_PKEY_keygen(kc,key)>0); EVP_PKEY_CTX_free(kc);
    X509 *x=X509_new(); CHECK(x); CHECK(X509_set_version(x,2)); CHECK(ASN1_INTEGER_set(X509_get_serialNumber(x),1));
    CHECK(X509_gmtime_adj(X509_getm_notBefore(x),-60)); CHECK(X509_gmtime_adj(X509_getm_notAfter(x),3600));
    CHECK(X509_set_pubkey(x,*key)); X509_NAME *name=X509_get_subject_name(x);
    CHECK(X509_NAME_add_entry_by_txt(name,"CN",MBSTRING_ASC,(const unsigned char *)"fixture.test",-1,-1,0));
    CHECK(X509_set_issuer_name(x,name));
    if(pad) {
        unsigned char *bytes=malloc(pad); CHECK(bytes); for(size_t i=0;i<pad;i++)bytes[i]=(unsigned char)(i*37+11);
        ASN1_OCTET_STRING *value=ASN1_OCTET_STRING_new(); ASN1_OBJECT *oid=OBJ_txt2obj("1.3.6.1.4.1.55555.1",1);
        CHECK(value && oid); CHECK(ASN1_OCTET_STRING_set(value,bytes,(int)pad));
        X509_EXTENSION *ext=X509_EXTENSION_create_by_OBJ(NULL,oid,0,value); CHECK(ext); CHECK(X509_add_ext(x,ext,-1));
        X509_EXTENSION_free(ext);ASN1_OBJECT_free(oid);ASN1_OCTET_STRING_free(value);free(bytes);
    }
    CHECK(X509_sign(x,*key,EVP_sha256())>0); return x;
}
static void attach(Pair *p) {
    BIO *cb=NULL,*sb=NULL; CHECK(BIO_new_bio_pair(&cb,p->capacity,&sb,p->capacity));
    SSL_set_bio(p->c,cb,cb); SSL_set_bio(p->s,sb,sb); SSL_set_connect_state(p->c); SSL_set_accept_state(p->s);
    SSL_set_msg_callback(p->c,message); SSL_set_msg_callback_arg(p->c,&p->stats);
}
#ifdef RESUME_COALESCING
static int padded_extension;
static unsigned char ext_padding[8000];
static int add_padding(SSL *ssl,unsigned int type,unsigned int context,const unsigned char **out,size_t *len,X509 *x,size_t chain,int *alert,void *arg){
    (void)ssl;(void)type;(void)x;(void)chain;(void)alert;(void)arg;*out=ext_padding;*len=context==SSL_EXT_CLIENT_HELLO?0:sizeof(ext_padding);return 1;
}
static int parse_padding(SSL *ssl,unsigned int type,unsigned int context,const unsigned char *in,size_t len,X509 *x,size_t chain,int *alert,void *arg){
    (void)ssl;(void)type;(void)in;(void)x;(void)chain;(void)alert;(void)arg;return len==(context==SSL_EXT_CLIENT_HELLO?0:sizeof(ext_padding));
}
#endif
static void make(Pair *p,size_t pad,size_t capacity,int fragment,int mfl,int partial,int callback) {
    memset(p,0,sizeof(*p));p->capacity=capacity;
    p->cc=SSL_CTX_new(TLS_client_method());p->sc=SSL_CTX_new(TLS_server_method());CHECK(p->cc&&p->sc);
#ifdef RESUME_COALESCING
    if(padded_extension){unsigned int flags=SSL_EXT_CLIENT_HELLO|SSL_EXT_TLS1_3_ENCRYPTED_EXTENSIONS;
        CHECK(SSL_CTX_add_custom_ext(p->cc,65400,flags,add_padding,NULL,NULL,parse_padding,NULL));
        CHECK(SSL_CTX_add_custom_ext(p->sc,65400,flags,add_padding,NULL,NULL,parse_padding,NULL));}
#endif
    CHECK(SSL_CTX_set_min_proto_version(p->cc,TLS1_3_VERSION));CHECK(SSL_CTX_set_max_proto_version(p->cc,TLS1_3_VERSION));
    CHECK(SSL_CTX_set_min_proto_version(p->sc,TLS1_3_VERSION));CHECK(SSL_CTX_set_max_proto_version(p->sc,TLS1_3_VERSION));
    CHECK(SSL_CTX_set_ciphersuites(p->cc,"TLS_AES_128_GCM_SHA256"));CHECK(SSL_CTX_set_ciphersuites(p->sc,"TLS_AES_128_GCM_SHA256"));
    if(pad)SSL_CTX_set_options(p->sc,SSL_OP_NO_TX_CERTIFICATE_COMPRESSION);
    CHECK(SSL_CTX_set_num_tickets(p->sc,0));SSL_CTX_set_session_cache_mode(p->sc,SSL_SESS_CACHE_OFF);
    EVP_PKEY *key=NULL;X509 *cert=certificate(&key,pad);
    CHECK(SSL_CTX_use_certificate(p->sc,cert));CHECK(SSL_CTX_use_PrivateKey(p->sc,key));CHECK(SSL_CTX_check_private_key(p->sc));
    CHECK(X509_STORE_add_cert(SSL_CTX_get_cert_store(p->cc),cert));SSL_CTX_set_verify(p->cc,SSL_VERIFY_PEER,NULL);
    X509_free(cert);EVP_PKEY_free(key);p->c=SSL_new(p->cc);p->s=SSL_new(p->sc);CHECK(p->c&&p->s);
    CHECK(SSL_set1_host(p->c,"fixture.test"));
    if(fragment)CHECK(SSL_set_max_send_fragment(p->s,fragment));
    if(mfl)CHECK(SSL_set_tlsext_max_fragment_length(p->c,TLSEXT_max_fragment_length_512));
    if(partial)SSL_set_mode(p->s,SSL_MODE_ENABLE_PARTIAL_WRITE);
    if(callback)SSL_set_msg_callback(p->s,noop);
    attach(p);
}
static int step(SSL *ssl,Stats *st) {
    int ret=SSL_do_handshake(ssl); if(ret==1)return 1;
    int e=SSL_get_error(ssl,ret);if(e==SSL_ERROR_WANT_WRITE){st->want_write++;
#ifdef COALESCE_INTERNAL
        SSL_CONNECTION *sc=SSL_CONNECTION_FROM_SSL(ssl);
        if(sc->server && sc->coalesced_flight && sc->coalesced_finished)st->pending_flight++;
#endif
        return 0;}
    CHECK(e==SSL_ERROR_WANT_READ);return 0;
}
static void handshake(Pair *p) {
    int cd=0,sd=0;for(int i=0;i<200000 && !(cd&&sd);i++) {
        if (!cd)
            cd = step(p->c, &p->stats);
        if (!sd)
            sd = step(p->s, &p->stats);
    }
    CHECK(cd&&sd);CHECK(SSL_get_verify_result(p->c)==X509_V_OK);
}
static void exchange(Pair *p) {
    static const char payload[]="verified application payload";unsigned char out[sizeof(payload)];
    int wd=0,rd=0;size_t nw=0,nr=0;
    for(int i=0;i<200000 && !(wd&&rd);i++) {
        if(!wd) { int r=SSL_write_ex(p->s,payload,sizeof(payload),&nw);if(r)wd=1;else {int e=SSL_get_error(p->s,r);CHECK(e==SSL_ERROR_WANT_READ||e==SSL_ERROR_WANT_WRITE);} }
        if(!rd) { int r=SSL_read_ex(p->c,out,sizeof(out),&nr);if(r)rd=1;else {int e=SSL_get_error(p->c,r);CHECK(e==SSL_ERROR_WANT_READ||e==SSL_ERROR_WANT_WRITE);} }
    }
    CHECK(wd&&rd&&nw==sizeof(payload)&&nr==sizeof(payload));CHECK(memcmp(payload,out,sizeof(payload))==0);
}
static void clear_pair(Pair *p) {
    CHECK(SSL_clear(p->c));CHECK(SSL_clear(p->s));CHECK(SSL_set_session(p->c,NULL));memset(&p->stats,0,sizeof(p->stats));attach(p);
}
static void release(Pair *p) { SSL_free(p->c);SSL_free(p->s);SSL_CTX_free(p->cc);SSL_CTX_free(p->sc); }
static void run(const char *name,size_t pad,size_t capacity,int fragment,int mfl,int partial,int callback,int reuse) {
    Pair p;make(&p,pad,capacity,fragment,mfl,partial,callback);
    int hrr=strcmp(name,"hello-retry-request")==0;
    if(hrr){CHECK(SSL_set1_groups_list(p.c,"P-256:X25519"));CHECK(SSL_set1_groups_list(p.s,"X25519"));}
    int compressed=strcmp(name,"brotli-compressed-certificate")==0;
    if(compressed){SSL_clear_options(p.s,SSL_OP_NO_TX_CERTIFICATE_COMPRESSION);int alg=TLSEXT_comp_cert_brotli;CHECK(SSL_set1_cert_comp_preference(p.c,&alg,1));CHECK(SSL_set1_cert_comp_preference(p.s,&alg,1));CHECK(SSL_compress_certs(p.s,alg));}
    handshake(&p);CHECK(!SSL_session_reused(p.c));if(hrr)CHECK(p.stats.server_hellos==2);if(compressed)CHECK(p.stats.compressed_certs==1);
    unsigned rec=p.stats.records,max=p.stats.max_record,ww=p.stats.want_write,pending=p.stats.pending_flight,wrappers=p.stats.encrypted_bytes-p.stats.message_bytes,compressed_count=p.stats.compressed_certs,hellos=p.stats.server_hellos;
    CHECK(p.stats.handshakes>=5);if(fragment||mfl)CHECK(max<=529);
    /* The byte-saving behavior is a regression invariant, not just a report. */
    if(fragment||mfl)CHECK(rec==(p.stats.message_bytes+511)/512);
    else CHECK(rec==(callback?4:pad>16384?5:1));
    CHECK(wrappers==22*rec);
    if(capacity<=256)CHECK(ww>0);
#ifdef COALESCE_INTERNAL
    if(pad==8000 && !callback)CHECK(pending>0);
#endif
    exchange(&p);
    if(reuse){clear_pair(&p);handshake(&p);exchange(&p);}
    printf("{\"case\":\"%s\",\"records\":%u,\"max_encrypted_payload\":%u,\"want_write\":%u,\"pending_flight_retries\":%u,\"wrapper_bytes\":%u,\"compressed_certificate_messages\":%u,\"server_hellos\":%u,\"verified\":true,\"reuse\":%s}\n",name,rec,max,ww,pending,wrappers,compressed_count,hellos,reuse?"true":"false");release(&p);
}
static void pending_clear(int free_only) {
    Pair p;make(&p,8000,32,0,0,0,0);int found=0;
    for(int i=0;i<200000&&!found;i++) {
        step(p.c,&p.stats);int ret=SSL_do_handshake(p.s);
        if(ret!=1){int e=SSL_get_error(p.s,ret);CHECK(e==SSL_ERROR_WANT_READ||e==SSL_ERROR_WANT_WRITE);
            found=e==SSL_ERROR_WANT_WRITE&&SSL_get_state(p.s)==TLS_ST_SW_FINISHED;
#ifdef COALESCE_INTERNAL
            SSL_CONNECTION *sc=SSL_CONNECTION_FROM_SSL(p.s);
            found=found&&sc->coalesced_flight&&sc->coalesced_finished;
#endif
        }
    }
    CHECK(found);
    if(!free_only){clear_pair(&p);handshake(&p);exchange(&p);}
    release(&p);printf("{\"case\":\"pending-finished-%s\",\"verified\":true}\n",free_only?"free":"clear-reuse");
}
static void excluded_cases(void) {
    Pair p;
    make(&p,0,64,0,0,0,0);
    CHECK(SSL_set_min_proto_version(p.c,TLS1_2_VERSION));CHECK(SSL_set_max_proto_version(p.c,TLS1_2_VERSION));
    CHECK(SSL_set_min_proto_version(p.s,TLS1_2_VERSION));CHECK(SSL_set_max_proto_version(p.s,TLS1_2_VERSION));
    handshake(&p);CHECK(SSL_version(p.c)==TLS1_2_VERSION);exchange(&p);release(&p);
    printf("{\"case\":\"excluded-tls12\",\"verified\":true}\n");

    make(&p,0,64,0,0,0,0);
    CHECK(SSL_use_certificate(p.c,SSL_get_certificate(p.s)));CHECK(SSL_use_PrivateKey(p.c,SSL_get_privatekey(p.s)));
    CHECK(X509_STORE_add_cert(SSL_CTX_get_cert_store(p.sc),SSL_get_certificate(p.s)));
    SSL_set_verify(p.s,SSL_VERIFY_PEER|SSL_VERIFY_FAIL_IF_NO_PEER_CERT,NULL);
    handshake(&p);CHECK(SSL_get_verify_result(p.s)==X509_V_OK);CHECK(p.stats.records==5);
    exchange(&p);release(&p);
    printf("{\"case\":\"excluded-client-auth\",\"records\":5,\"verified\":true}\n");

    make(&p,0,32768,0,0,0,0);
    CHECK(SSL_set_mode(p.s,SSL_MODE_ASYNC)&SSL_MODE_ASYNC);
    handshake(&p);CHECK(p.stats.records==4);exchange(&p);release(&p);
    printf("{\"case\":\"excluded-async-mode\",\"records\":4,\"verified\":true}\n");

    make(&p,0,32768,0,0,0,0);CHECK(SSL_set_num_tickets(p.s,1));
    handshake(&p);exchange(&p);
    SSL_SESSION *session=SSL_get1_session(p.c);CHECK(session);CHECK(SSL_SESSION_is_resumable(session));
    SSL_set_quiet_shutdown(p.c,1);SSL_set_quiet_shutdown(p.s,1);CHECK(SSL_shutdown(p.c)==1);CHECK(SSL_shutdown(p.s)==1);
    clear_pair(&p);CHECK(SSL_set_session(p.c,session));SSL_SESSION_free(session);
    handshake(&p);CHECK(SSL_session_reused(p.c));CHECK(SSL_session_reused(p.s));
#ifdef RESUME_COALESCING
    CHECK(p.stats.records==1);
#else
    CHECK(p.stats.records==2);
#endif
    unsigned resumed_records=p.stats.records,resumed_wrappers=p.stats.encrypted_bytes-p.stats.message_bytes;
    exchange(&p);release(&p);
    printf("{\"case\":\"resumption\",\"records\":%u,\"wrapper_bytes\":%u,\"verified\":true}\n",resumed_records,resumed_wrappers);
}
static void excluded_early_data(void) {
    for(int accept=0;accept<=1;accept++) {
        Pair p;make(&p,0,32768,0,0,0,0);
        CHECK(SSL_set_num_tickets(p.s,1));CHECK(SSL_set_max_early_data(p.s,1024));
        /* Only this isolated BIO fixture disables replay tracking for its ticket. */
        SSL_set_options(p.s,SSL_OP_NO_ANTI_REPLAY);
        handshake(&p);exchange(&p);
        SSL_SESSION *session=SSL_get1_session(p.c);
        CHECK(session&&SSL_SESSION_is_resumable(session)&&SSL_SESSION_get_max_early_data(session)==1024);
        SSL_set_quiet_shutdown(p.c,1);SSL_set_quiet_shutdown(p.s,1);CHECK(SSL_shutdown(p.c)==1);CHECK(SSL_shutdown(p.s)==1);
        clear_pair(&p);CHECK(SSL_set_num_tickets(p.s,0));CHECK(SSL_set_session(p.c,session));SSL_SESSION_free(session);
        if(!accept)CHECK(SSL_set_max_early_data(p.s,0));
        static const char early[]="fixture early data";unsigned char out[sizeof(early)];size_t written=0,received=0;
        CHECK(SSL_write_early_data(p.c,early,sizeof(early),&written));CHECK(written==sizeof(early));
        CHECK(SSL_read_early_data(p.s,out,sizeof(out),&received)==(accept?SSL_READ_EARLY_DATA_SUCCESS:SSL_READ_EARLY_DATA_FINISH));
        if(accept)CHECK(received==sizeof(early)&&memcmp(out,early,sizeof(early))==0);
        else CHECK(received==0);
        handshake(&p);CHECK(SSL_session_reused(p.c)&&SSL_session_reused(p.s));
        CHECK(SSL_get_early_data_status(p.c)==(accept?SSL_EARLY_DATA_ACCEPTED:SSL_EARLY_DATA_REJECTED));
        CHECK(SSL_get_early_data_status(p.s)==(accept?SSL_EARLY_DATA_ACCEPTED:SSL_EARLY_DATA_REJECTED));
        CHECK(p.stats.records==2);exchange(&p);release(&p);
        printf("{\"case\":\"excluded-early-data-%s\",\"records\":2,\"early_data_verified\":true,\"verified\":true}\n",accept?"accepted":"rejected");
    }
}
#ifdef RESUME_COALESCING
static void resumed_pending_retry(void){
    Pair p;padded_extension=1;make(&p,0,32768,0,0,0,0);padded_extension=0;
    CHECK(SSL_set_num_tickets(p.s,1));handshake(&p);exchange(&p);
    SSL_SESSION *session=SSL_get1_session(p.c);CHECK(session&&SSL_SESSION_is_resumable(session));
    SSL_set_quiet_shutdown(p.c,1);SSL_set_quiet_shutdown(p.s,1);CHECK(SSL_shutdown(p.c)==1);CHECK(SSL_shutdown(p.s)==1);
    p.capacity=64;clear_pair(&p);CHECK(SSL_set_num_tickets(p.s,0));CHECK(SSL_set_session(p.c,session));SSL_SESSION_free(session);
    handshake(&p);CHECK(SSL_session_reused(p.c)&&SSL_session_reused(p.s));CHECK(p.stats.records==1);CHECK(p.stats.pending_flight>0);
    unsigned retries=p.stats.pending_flight;exchange(&p);release(&p);
    printf("{\"case\":\"resumed-padded-ee-retry\",\"records\":1,\"pending_flight_retries\":%u,\"verified\":true}\n",retries);
}
#endif
#ifdef COALESCE_INTERNAL
static void allocation_fault(int kind) {
    Pair p;make(&p,0,32768,0,0,0,0);fault_server=p.s;fault_kind=kind;fault_fired=0;
    int cf=0,sf=0;
    for(int i=0;i<10000&&!(cf&&sf);i++) {
        if(!cf){ERR_clear_error();int r=SSL_do_handshake(p.c);if(r!=1){int e=SSL_get_error(p.c,r);if(e!=SSL_ERROR_WANT_READ&&e!=SSL_ERROR_WANT_WRITE)cf=1;}}
        if(!sf){ERR_clear_error();int r=SSL_do_handshake(p.s);if(r!=1){int e=SSL_get_error(p.s,r);if(e!=SSL_ERROR_WANT_READ&&e!=SSL_ERROR_WANT_WRITE)sf=1;}}
    }
    fault_server=NULL;fault_kind=0;CHECK(fault_fired&&cf&&sf);CHECK(p.stats.alerts>0);ERR_clear_error();
    clear_pair(&p);handshake(&p);exchange(&p);release(&p);
    make(&p,0,32768,0,0,0,0);handshake(&p);exchange(&p);release(&p);
    printf("{\"case\":\"allocation-fault-%d\",\"fault_fired\":true,\"client_alert\":true,\"clear_reuse\":true,\"fresh_connection\":true,\"verified\":true}\n",kind);
}
#endif
int main(void) {
#ifdef COALESCE_INTERNAL
    CHECK(CRYPTO_set_mem_functions(test_malloc,test_realloc,test_free));
#endif
    printf("{\"openssl\":\"%s\"}\n",OpenSSL_version(OPENSSL_VERSION));
    run("normal",0,32768,0,0,0,0,1);
    run("brotli-compressed-certificate",2048,64,0,0,0,0,0);
    run("hello-retry-request",0,64,0,0,0,0,0);
    run("tiny-bio",0,64,0,0,0,0,1);
    run("large-cert-tiny-bio",8000,256,0,0,0,0,1);
    run("large-cert-4k-bio",8000,4096,0,0,0,0,0);
    run("overflow-cert",20000,256,0,0,0,0,1);
    run("max-send-fragment-512",8000,64,512,0,0,0,0);
    run("peer-max-fragment-512",8000,64,0,1,0,0,0);
    run("partial-write-mode",8000,64,0,0,1,0,0);
    run("server-msg-callback",0,64,0,0,0,1,0);
    pending_clear(0);pending_clear(1);excluded_cases();excluded_early_data();
#ifdef RESUME_COALESCING
    resumed_pending_retry();
#endif
#ifdef COALESCE_INTERNAL
    allocation_fault(1);allocation_fault(2);allocation_fault(3);
#endif
    return 0;
}
