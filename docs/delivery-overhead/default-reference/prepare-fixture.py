from pathlib import Path
import argparse, ast, base64, hashlib, json, shutil
from datetime import datetime, timezone, timedelta
from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
root=args.repo.resolve();out=args.out.resolve()
assert not out.exists();out.mkdir(mode=0o755)
(out/'public').mkdir();(out/'empty-cache').mkdir()
for name in ['index.html','index.html.br','index.html.gz','index.html.deflate','representations.json']:
 shutil.copyfile(root/'public'/name,out/'public'/name)
shutil.copyfile(root/'server/site.js',out/'public/site.js')
now=datetime.now(timezone.utc)
def key():return ec.generate_private_key(ec.SECP256R1())
def name(text):return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,text)])
rk,ik,lk,wrongkey=key(),key(),key(),key()
def certificate(subject,issuer,pub,signer,ca,path=None,san=False):
 b=x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(pub).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=7)).add_extension(x509.BasicConstraints(ca=ca,path_length=path),critical=True).add_extension(x509.SubjectKeyIdentifier.from_public_key(pub),critical=False).add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(signer.public_key()),critical=False)
 if ca:b=b.add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),critical=True)
 else:b=b.add_extension(x509.KeyUsage(True,False,False,False,False,False,False,False,False),critical=True).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False).add_extension(x509.SubjectAlternativeName([x509.DNSName('tomkimberlin.com')]),critical=False)
 return b.sign(signer,hashes.SHA256())
rn,inn,ln=name('1KB comparison test root'),name('1KB comparison test intermediate'),name('tomkimberlin.com')
rc=certificate(rn,rn,rk.public_key(),rk,True,1);ic=certificate(inn,rn,ik.public_key(),rk,True,0);lc=certificate(ln,inn,lk.public_key(),ik,False)
wc=certificate(name('Unrelated test root'),name('Unrelated test root'),wrongkey.public_key(),wrongkey,True,1)
pem=lambda c:c.public_bytes(serialization.Encoding.PEM)
(out/'root.pem').write_bytes(pem(rc));(out/'chain.pem').write_bytes(pem(lc)+pem(ic));(out/'wrong-root.pem').write_bytes(pem(wc))
(out/'key.pem').write_bytes(lk.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
# Only generated fixture material; its enclosing remote staging directory is private.
(out/'key.pem').chmod(0o644)
stock_global='''user nginx;
worker_processes 1;
error_log /dev/stderr warn;
pid /tmp/nginx.pid;
events { worker_connections 1024; }
http {
 client_body_temp_path /tmp/client_temp;
 proxy_temp_path /tmp/proxy_temp;
 fastcgi_temp_path /tmp/fastcgi_temp;
 uwsgi_temp_path /tmp/uwsgi_temp;
 scgi_temp_path /tmp/scgi_temp;
 include /etc/nginx/mime.types;
 default_type application/octet-stream;
 access_log /dev/stdout;
 sendfile on;
 keepalive_timeout 65;
 server {
  listen 127.0.0.1:8443 ssl;
  http2 on;
  server_name tomkimberlin.com;
  ssl_certificate /fixture/chain.pem;
  ssl_certificate_key /fixture/key.pem;
  LOCATION
 }
}
'''
(out/'stock-identity.conf').write_text(stock_global.replace('LOCATION','location / { root /fixture/public; index index.html index.htm; }'))
(out/'stock-brotli.conf').write_text(stock_global.replace('LOCATION','location = / { root /fixture/public; try_files /index.html.br =404; default_type text/html; add_header Content-Encoding br; }'))
production=(root/'server/nginx.conf').read_text();common=production.split('http {\n',1)[1].split('\n    acme_issuer ',1)[0]
common=common.replace('/srv/current/','/fixture/public/')
optimized='''load_module /usr/lib/nginx/modules/ngx_http_js_module.so;
load_module /usr/lib/nginx/modules/ngx_http_headers_more_filter_module.so;
worker_processes 1;
error_log /dev/stderr warn;
pid /tmp/nginx.pid;
events { worker_connections 1024; }
http {
 client_body_temp_path /tmp/client_temp;
 proxy_temp_path /tmp/proxy_temp;
 fastcgi_temp_path /tmp/fastcgi_temp;
 uwsgi_temp_path /tmp/uwsgi_temp;
 scgi_temp_path /tmp/scgi_temp;
'''+common+'''
 server {
  listen 127.0.0.1:8443 ssl;
  http2 on;
  server_name tomkimberlin.com;
  ssl_certificate /fixture/chain.pem;
  ssl_certificate_key /fixture/key.pem;
  ssl_certificate_compression on;
  ssl_certificate_compression_brotli_cache /fixture/empty-cache;
  location / { js_content site.serve; js_header_filter site.headers; }
 }
}
'''
(out/'optimized.conf').write_text(optimized)
# Extract the audited TLS/HTTP loop; omit DNS and packet capture, never fake their counters.
source=(root/'tools/compare-gallery.py').read_text();tree=ast.parse(source)
byname={n.name:ast.get_source_segment(source,n) for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
headers=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='HEADERS' for t in n.targets))
f=byname['run']
changes=[
 ('def run(url,port,outdir,curve=None):','def measure(host,port,ca,expected,expected_encoding):'),
 ('    validate_outputs([url],outdir)\n    host,path=url_parts(url)\n','    path="/"\n'),
 ('    ip=socket.gethostbyname(host)\n    dns_results=dns(host)\n    packets=[];capture_errors=[];stop=threading.Event()','    ip="127.0.0.1"'),
 ("        if capture_errors:\n            raise RuntimeError('Packet capture failed: '+str(capture_errors[0])) from capture_errors[0]\n",''),
 ('    raw=sock=thread=None;started=False;capture_stats=None','    sock=None'),
 ('        raw=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,0)\n',''),
 ("        context=ssl.create_default_context();context.set_alpn_protocols(['h2','http/1.1'])\n        if curve:context.set_ecdh_curve(curve)","        context=ssl.create_default_context(cafile=ca);context.set_alpn_protocols(['h2','http/1.1'])"),
 ("sock.bind(('0.0.0.0',port))","sock.bind(('127.0.0.1',0))"),
 ("        attach_capture_filter(raw,kernel_capture_filter(ip,port))\n        raw.bind(('br0',3));raw.settimeout(.1)\n",''),
 ('sock.connect((ip,443))','sock.connect((ip,port))'),
 ('''        # The bound raw socket already queues SYN/handshake packets. Start its
        # reader once connect has selected the actual local IPv4 address, so
        # another host using the same source port cannot contaminate the count.
        thread=threading.Thread(target=capture_packets,args=(raw,stop,packets,capture_errors,ip,port,local_ip))
        thread.start();started=True
''',''),
 ("        negotiated=tls.selected_alpn_protocol();response=[];body=bytearray();response_plain=bytearray()","        negotiated=tls.selected_alpn_protocol();assert negotiated=='h2';response=[];body=bytearray();response_plain=bytearray()"),
 ("result={'url':url,","result={'url':'https://'+host+'/',"),
 ("'response_http_plain_bytes':len(response_plain),'dns_queries':dns_results}","'response_http_plain_bytes':len(response_plain),'session_reused':tls.session_reused}"),
]
for old,new in changes:
 assert f.count(old)==1,old;f=f.replace(old,new)
start=f.index('    finally:\n        try:\n            if sock is not None:sock.close()')
f=f[:start]+'''    finally:
        if sock is not None:sock.close()
    check_progress()
    if decoded != expected:raise ValueError('Decoded document differs from expected source')
    if encoding != expected_encoding:raise ValueError('Unexpected content encoding')
    expected_encoded=expected if expected_encoding=='identity' else Path('/fixture/public/index.html.br').read_bytes()
    if bytes(body)!=expected_encoded:raise ValueError('Encoded body differs from fixed fixture representation')
    if result['session_reused']:raise ValueError('Expected a fresh connection')
    if result['tls'] != 'TLSv1.3':raise ValueError('Expected TLS 1.3')
    result['tls_minus_body']=sum(body_complete.values())-len(body)
    result['http_plain_minus_body']=len(response_plain)-len(body)
    result['source_sha256']=hashlib.sha256(decoded).hexdigest()
    result['measured_at_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    return result
'''
probe='''"""TLS-only adaptation of the audited gallery loop for isolated paired fixtures.
No DNS or packet capture. No verification bypass. Counts actual MemoryBIO bytes.
"""
import argparse, hashlib, io, json, platform, select, socket, ssl, time, zlib
from pathlib import Path
import brotli, h11, h2, h2.config, h2.connection, h2.events, zstandard
MAX_BODY_BYTES=1<<20
MAX_ZSTD_WINDOW_BYTES=1<<20
MAX_HTTP_PLAIN_BYTES=2<<20
MAX_TLS_BYTES=4<<20
EXCHANGE_SECONDS=30
'''+repr('')+'\nHEADERS='+repr(headers)+'\n'+byname['require_bounded_brotli']+'\n\n'+byname['decode_body']+'\n\n'+f+'''
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--ca',default='/fixture/root.pem');p.add_argument('--encoding',required=True);a=p.parse_args()
 result=measure('tomkimberlin.com',8443,a.ca,Path('/fixture/public/index.html').read_bytes(),a.encoding)
 result['client']={'python':platform.python_version(),'openssl':ssl.OPENSSL_VERSION,'h2':h2.__version__,'h11':h11.__version__,'brotli':brotli.__version__,'zstandard':zstandard.__version__}
 result['probe_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
 print(json.dumps(result))
'''
# Encoding is derived exactly as in the source but was below its old finally.
needle='    check_progress()\n    if decoded != expected:'
probe=probe.replace(needle,"    check_progress()\n    encoding=','.join(value for key,value in response if key=='content-encoding') or 'identity'\n    decoded=decode_body(bytes(body),encoding)\n    result['decoded_body_bytes']=len(decoded)\n    if decoded != expected:")
compile(probe,'probe.py','exec');(out/'probe.py').write_text(probe)
assert hashlib.sha256(source.encode()).hexdigest()=='286b80603699b7eaafd0bebaaef669831e0f86ab8a28d60881ac2ccf63724256', 'Use the documented source revision'
manifest={'sourceGallerySha256':hashlib.sha256(source.encode()).hexdigest(),'probeSha256':hashlib.sha256(probe.encode()).hexdigest(),'certificateDERBytes':{'leaf':len(lc.public_bytes(serialization.Encoding.DER)),'intermediate':len(ic.public_bytes(serialization.Encoding.DER)),'root':len(rc.public_bytes(serialization.Encoding.DER))},'certificateChainSha256':hashlib.sha256((out/'chain.pem').read_bytes()).hexdigest(),'testOnlyCA':True,'productionKeysAccessed':False,'optimizedCache':'Empty fixture cache; normal certificate compression fallback, no production cache copied.'}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))

files=sorted(p for p in out.rglob('*') if p.is_file() and p.name!='SHA256SUMS')
(out/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  input/'+str(p.relative_to(out))+'\n' for p in files))
