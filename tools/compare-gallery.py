"""Controlled cold document exchanges, with metadata-only capture of owned TCP flows.

Not a browser load: excludes subresources, favicon discovery, redirects and browser DNS.
Runs on Alfred in an ephemeral container using the site's compression-enabled OpenSSL.
"""
import argparse, gzip, hashlib, json, math, select, socket, ssl, struct, threading, time
from pathlib import Path
from urllib.parse import urlsplit
import brotli, h11, h2.config, h2.connection, h2.events

URLS = ['https://tomkimberlin.com/', 'https://pba.im/200B', 'https://cv.btxx.org/',
        'https://5.vg/', 'https://1k.lom.me/', 'https://hi.mrkrk.me/']
HEADERS = [('accept-encoding', 'gzip, deflate, br, zstd'),
 ('sec-ch-ua', '"Chromium";v="145", "Not:A-Brand";v="99"'),
 ('sec-ch-ua-mobile', '?0'), ('sec-ch-ua-platform', '"macOS"'),
 ('upgrade-insecure-requests', '1'),
 ('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'),
 ('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'),
 ('sec-fetch-site', 'none'), ('sec-fetch-mode', 'navigate'), ('sec-fetch-user', '?1'),
 ('sec-fetch-dest', 'document'), ('accept-language', 'en-US,en;q=0.9'), ('priority', 'u=0, i')]

def dns(host):
    results=[]
    for typ in (1,28,65):
        ident=0x7300+typ
        q=struct.pack('!6H',ident,0x0100,1,0,0,0)+b''.join(bytes([len(x)])+x.encode() for x in host.split('.'))+b'\0'+struct.pack('!HH',typ,1)
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as s:
            s.settimeout(10);s.sendto(q,('1.1.1.1',53));r,_=s.recvfrom(4096)
        assert int.from_bytes(r[:2],'big')==ident
        results.append({'qtype':typ,'query_bytes':len(q),'response_bytes':len(r),'ipv4_udp_bytes':len(q)+len(r)+56})
    return results

def run(url,port,outdir,curve=None):
    u=urlsplit(url);host=u.hostname;ip=socket.gethostbyname(host);path=u.path or '/'
    dns_results=dns(host)
    packets=[];stop=threading.Event()
    raw=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(3));raw.bind(('br0',0));raw.settimeout(.1)
    def capture():
        while not stop.is_set():
            try:b=raw.recv(65535)
            except TimeoutError:continue
            if len(b)<54 or b[12:14]!=b'\x08\x00':continue
            p=b[14:];ihl=(p[0]&15)*4
            if p[9]!=6:continue
            src,dst=socket.inet_ntoa(p[12:16]),socket.inet_ntoa(p[16:20]);sp,dp=struct.unpack('!HH',p[ihl:ihl+4])
            if dst==ip and sp==port and dp==443:direction='sent'
            elif src==ip and dp==port and sp==443:direction='received'
            else:continue
            length=int.from_bytes(p[2:4],'big');thl=(p[ihl+12]>>4)*4;payload=length-ihl-thl
            segments=max(1,math.ceil(payload/(1500-ihl-thl)))
            packets.append({'direction':direction,'ip_bytes':length,'tcp_payload_bytes':payload,
                'ip_header_bytes':ihl,'tcp_header_bytes':thl,'flags':p[ihl+13],
                'seq':int.from_bytes(p[ihl+4:ihl+8],'big'),
                'estimated_segments_at_1500_mtu':segments,
                'ip_bytes_at_1500_mtu':length+(segments-1)*(ihl+thl)})
    thread=threading.Thread(target=capture);thread.start()
    context=ssl.create_default_context();context.set_alpn_protocols(['h2','http/1.1'])
    if curve:context.set_ecdh_curve(curve)
    messages=[];keyshares=[]
    def msg(obj,direction,version,content_type,msg_type,data):
        if int(content_type)!=22:return
        messages.append({'direction':direction,'type':int(msg_type),'bytes':len(data)})
        if direction=='read' and int(msg_type)==2:
            b=data[4:];offset=35+b[34]+3
            total=int.from_bytes(b[offset:offset+2],'big');offset+=2;end=offset+total
            while offset+4<=end:
                typ=int.from_bytes(b[offset:offset+2],'big');n=int.from_bytes(b[offset+2:offset+4],'big');offset+=4
                if typ==51:keyshares.append(int.from_bytes(b[offset:offset+2],'big'))
                offset+=n
    context._msg_callback=msg
    incoming,outgoing=ssl.MemoryBIO(),ssl.MemoryBIO()
    tls=context.wrap_bio(incoming,outgoing,server_hostname=host)
    sock=socket.socket();sock.settimeout(15);sock.bind(('0.0.0.0',port))
    counts={'sent':0,'received':0};ended=False
    def flush():
        while outgoing.pending:
            b=outgoing.read();sock.sendall(b);counts['sent']+=len(b)
    def receive():
        nonlocal ended
        b=sock.recv(65536)
        if not b:incoming.write_eof();ended=True;return
        counts['received']+=len(b);incoming.write(b)
    def read():
        while True:
            try:return tls.read(65536)
            except ssl.SSLWantReadError:flush();receive()
            except ssl.SSLEOFError:return b''
    def send(b):
        if b:tls.write(b);flush()
    try:
        sock.connect((ip,443))
        while True:
            try:tls.do_handshake();flush();break
            except ssl.SSLWantReadError:flush();receive()
        negotiated=tls.selected_alpn_protocol();response=[];body=bytearray();response_plain=bytearray()
        tls_metadata={'tls':tls.version(),'cipher':tls.cipher()[0],
                      'certificate_der_bytes':len(tls.getpeercert(binary_form=True))}
        if negotiated=='h2':
            conn=h2.connection.H2Connection(config=h2.config.H2Configuration(client_side=True,header_encoding='utf-8'))
            conn.initiate_connection();conn.send_headers(1,[(':method','GET'),(':scheme','https'),(':authority',host),(':path',path)]+HEADERS,end_stream=True);send(conn.data_to_send())
            done=False
            while not done:
                b=read()
                if not b:raise EOFError('Incomplete h2 response')
                response_plain.extend(b)
                for e in conn.receive_data(b):
                    if isinstance(e,h2.events.ResponseReceived):response=e.headers
                    elif isinstance(e,h2.events.DataReceived):body.extend(e.data);conn.acknowledge_received_data(e.flow_controlled_length,e.stream_id)
                    elif isinstance(e,h2.events.StreamEnded):done=True
                send(conn.data_to_send())
                if len(body)>1048576:raise ValueError('Body limit exceeded')
        else:
            conn=h11.Connection(h11.CLIENT)
            send(conn.send(h11.Request(method='GET',target=path,headers=[('host',host)]+HEADERS)));send(conn.send(h11.EndOfMessage()))
            while True:
                e=conn.next_event()
                if e is h11.NEED_DATA:
                    b=read();response_plain.extend(b);conn.receive_data(b)
                elif isinstance(e,h11.Response):response=[(':status',str(e.status_code))]+[(k.decode(),v.decode()) for k,v in e.headers]
                elif isinstance(e,h11.Data):body.extend(e.data)
                elif isinstance(e,h11.EndOfMessage):break
                elif isinstance(e,h11.ConnectionClosed):raise EOFError('Incomplete h1 response')
                if len(body)>1048576:raise ValueError('Body limit exceeded')
        body_complete=counts.copy()
        while not ended and select.select([sock],[],[],.08)[0]:
            receive()
            try:
                b=tls.read(65536)
                if not b:break
            except (ssl.SSLWantReadError,ssl.SSLEOFError):pass
        before_close=counts.copy()
        result={'url':url,'ip':ip,'openssl':ssl.OPENSSL_VERSION,**tls_metadata,'http':negotiated or 'http/1.1',
            'keyshare_group_ids':keyshares,'certificate_verified':True,'tls_handshake_messages':messages,
            'response_headers':[(k,'[redacted]' if k=='set-cookie' else v) for k,v in response],
            'body_bytes':len(body),'body_sha256':hashlib.sha256(body).hexdigest(),
            'tls_through_body_complete':body_complete,'tls_before_client_close':before_close,
            'response_http_plain_bytes':len(response_plain),'dns_queries':dns_results}
        if negotiated=='h2':
            b=bytes(response_plain);frames=[]
            while b:
                n=int.from_bytes(b[:3],'big');assert len(b)>=9+n
                frames.append({'type':b[3],'stream':int.from_bytes(b[5:9],'big')&0x7fffffff,'payload_bytes':n});b=b[9+n:]
            result['response_http2_frames']=frames
        headers=dict(response);encoding=headers.get('content-encoding','identity')
        decoded=brotli.decompress(body) if encoding=='br' else gzip.decompress(body) if encoding=='gzip' else body
        result['decoded_body_bytes']=len(decoded)
        (outdir/(host+'.html')).write_bytes(decoded)
        try:tls.unwrap()
        except (ssl.SSLWantReadError,ssl.SSLError):pass
        try:flush()
        except OSError:pass
    finally:
        sock.close();time.sleep(.25);stop.set();thread.join();raw.close()
    result['packets']=packets
    result['observed_ipv4_tcp_bytes']=sum(p['ip_bytes'] for p in packets)
    result['estimated_ipv4_tcp_bytes_1500_mtu']=sum(p['ip_bytes_at_1500_mtu'] for p in packets)
    result['dns_ipv4_udp_bytes']=sum(d['ipv4_udp_bytes'] for d in dns_results)
    result['estimated_tcp_plus_dns_bytes']=result['estimated_ipv4_tcp_bytes_1500_mtu']+result['dns_ipv4_udp_bytes']
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--curve');p.add_argument('--port',type=int,default=46240);p.add_argument('--urls',nargs='*');a=p.parse_args()
    out=Path(a.out);out.mkdir(exist_ok=True,parents=True);results=[]
    for i,url in enumerate(a.urls or URLS):
        try:r=run(url,a.port+i,out,a.curve)
        except Exception as e:r={'url':url,'error':str(e)}
        results.append(r);(out/'results.json').write_text(json.dumps({'time_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'request_headers':HEADERS,'forced_curve':a.curve,'results':results},indent=2)+'\n')
        print(json.dumps({k:v for k,v in r.items() if k in ('url','error','body_bytes','decoded_body_bytes','tls_through_body_complete','http','keyshare_group_ids','estimated_tcp_plus_dns_bytes','observed_ipv4_tcp_bytes')}),flush=True)
