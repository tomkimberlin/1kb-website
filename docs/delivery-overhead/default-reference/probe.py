"""TLS-only adaptation of the audited gallery loop for isolated paired fixtures.
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
''
HEADERS=[('accept-encoding', 'gzip, deflate, br, zstd'), ('sec-ch-ua', '"Chromium";v="145", "Not:A-Brand";v="99"'), ('sec-ch-ua-mobile', '?0'), ('sec-ch-ua-platform', '"macOS"'), ('upgrade-insecure-requests', '1'), ('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'), ('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'), ('sec-fetch-site', 'none'), ('sec-fetch-mode', 'navigate'), ('sec-fetch-user', '?1'), ('sec-fetch-dest', 'document'), ('accept-language', 'en-US,en;q=0.9'), ('priority', 'u=0, i')]
def require_bounded_brotli():
    # Version 1.2.1 fixes malformed block-switch parsing in the native decoder;
    # output limits alone do not protect that internal parser.
    try:
        version = tuple(int(part) for part in brotli.__version__.split('.'))
    except (AttributeError, TypeError, ValueError):
        version = ()
    if len(version) != 3 or version < (1, 2, 1):
        raise RuntimeError('Gallery decoding requires brotli >= 1.2.1')
    try:
        brotli.Decompressor().process(b'', output_buffer_limit=1)
    except TypeError as error:
        raise RuntimeError('Gallery decoding requires brotli >= 1.2.1 with output limits') from error

def decode_body(data, encoding, limit=MAX_BODY_BYTES):
    def bounded(value):
        if len(value) > limit:
            raise ValueError('Decoded body or intermediate encoding exceeds body limit')
        return value

    bounded(data)
    codings = encoding.lower().split(',')
    if len(codings) > 8:
        raise ValueError('Too many content encodings')
    # Content-Encoding lists transformations in the order they were applied.
    for coding in reversed(codings):
        coding = coding.strip()
        if coding == 'identity':
            continue
        if coding == 'br':
            require_bounded_brotli()
            decoder = brotli.Decompressor()
            parts = [bounded(decoder.process(data, output_buffer_limit=limit + 1))]
            size = len(parts[0])
            while not decoder.can_accept_more_data():
                part = decoder.process(b'', output_buffer_limit=limit - size + 1)
                size += len(part)
                if size > limit:
                    raise ValueError('Decoded body exceeds body limit')
                parts.append(part)
            if not decoder.is_finished():
                raise ValueError('Incomplete Brotli encoding')
            data = b''.join(parts)
        elif coding in ('gzip', 'deflate'):
            parts = []
            size = 0
            while data:
                decoder = zlib.decompressobj(31 if coding == 'gzip' else 15)
                part = decoder.decompress(data, limit - size + 1)
                size += len(part)
                if size > limit:
                    raise ValueError('Decoded body exceeds body limit')
                if not decoder.eof:
                    raise ValueError('Incomplete ' + coding + ' encoding')
                parts.append(part)
                data = decoder.unused_data
                if coding == 'gzip':
                    data = data.lstrip(b'\0')  # Match gzip's accepted zero padding.
                elif data:
                    raise ValueError('Trailing bytes in deflate encoding')
            if not parts:
                raise ValueError('Empty ' + coding + ' encoding')
            data = b''.join(parts)
        elif coding == 'zstd':
            # stream_reader bounds allocation/output, but accepts truncated final
            # frames. Validate exact completion only after bounded decoding, when
            # repeating the same input cannot yield an oversized complete output.
            with zstandard.ZstdDecompressor(max_window_size=MAX_ZSTD_WINDOW_BYTES).stream_reader(
                    io.BytesIO(data), read_across_frames=True) as reader:
                decoded = bounded(reader.read(limit + 1))
            remaining = data
            frames = 0
            while remaining:
                decoder = zstandard.ZstdDecompressor(max_window_size=MAX_ZSTD_WINDOW_BYTES).decompressobj()
                decoder.decompress(remaining)
                if not decoder.eof:
                    raise ValueError('Incomplete zstd encoding')
                remaining = decoder.unused_data
                frames += 1
            if not frames:
                raise ValueError('Empty zstd encoding')
            data = decoded
        else:
            raise ValueError('Unsupported content encoding: ' + coding)
        bounded(data)
    return data

def measure(host,port,ca,expected,expected_encoding):
    path="/"
    require_bounded_brotli()
    ip="127.0.0.1"
    deadline=time.monotonic()+EXCHANGE_SECONDS
    def check_progress():
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('TLS/HTTP exchange deadline exceeded')
        return remaining
    sock=None
    try:
        context=ssl.create_default_context(cafile=ca);context.set_alpn_protocols(['h2','http/1.1'])
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
        sock=socket.socket();sock.settimeout(15);sock.bind(('127.0.0.1',0))
        counts={'sent':0,'received':0};ended=False
        def flush():
            check_progress()
            while outgoing.pending:
                b=outgoing.read()
                if counts['sent']+len(b)>MAX_TLS_BYTES:raise ValueError('TLS byte limit exceeded')
                sock.settimeout(min(15,check_progress()));sock.sendall(b);counts['sent']+=len(b)
        def receive():
            nonlocal ended
            if ended:raise EOFError('TLS peer closed before response completed')
            sock.settimeout(min(15,check_progress()));b=sock.recv(65536)
            if not b:incoming.write_eof();ended=True;return
            counts['received']+=len(b)
            if counts['received']>MAX_TLS_BYTES:raise ValueError('TLS byte limit exceeded')
            incoming.write(b)
        def read():
            while True:
                check_progress()
                try:return tls.read(65536)
                except ssl.SSLWantReadError:flush();receive()
                except (ssl.SSLEOFError,ssl.SSLZeroReturnError):return b''
        def send(b):
            check_progress()
            if b:tls.write(b);flush()
        sock.settimeout(min(15,check_progress()));sock.connect((ip,port))
        local_ip=sock.getsockname()[0]
        while True:
            check_progress()
            try:tls.do_handshake();flush();break
            except ssl.SSLWantReadError:flush();receive()
        negotiated=tls.selected_alpn_protocol();assert negotiated=='h2';response=[];body=bytearray();response_plain=bytearray()
        def append_plain(data):
            if len(response_plain)+len(data)>MAX_HTTP_PLAIN_BYTES:raise ValueError('HTTP plaintext byte limit exceeded')
            response_plain.extend(data)
        def append_body(data):
            if len(body)+len(data)>MAX_BODY_BYTES:raise ValueError('Body limit exceeded')
            body.extend(data)
        tls_metadata={'tls':tls.version(),'cipher':tls.cipher()[0],
                      'certificate_der_bytes':len(tls.getpeercert(binary_form=True))}
        if negotiated=='h2':
            conn=h2.connection.H2Connection(config=h2.config.H2Configuration(client_side=True,header_encoding='utf-8'))
            conn.initiate_connection();conn.send_headers(1,[(':method','GET'),(':scheme','https'),(':authority',host),(':path',path)]+HEADERS,end_stream=True);send(conn.data_to_send())
            done=False
            while not done:
                b=read()
                if not b:raise EOFError('Incomplete h2 response')
                append_plain(b)
                for e in conn.receive_data(b):
                    if isinstance(e,h2.events.PushedStreamReceived):
                        raise ValueError('Unexpected pushed stream in single-document exchange')
                    connection_window=isinstance(e,h2.events.WindowUpdated) and e.stream_id==0
                    if hasattr(e,'stream_id') and e.stream_id!=1 and not connection_window:
                        raise ValueError('Unexpected h2 stream in single-document exchange')
                    if isinstance(e,h2.events.ResponseReceived):response=e.headers
                    elif isinstance(e,h2.events.DataReceived):append_body(e.data);conn.acknowledge_received_data(e.flow_controlled_length,e.stream_id)
                    elif isinstance(e,h2.events.StreamEnded):done=True
                    elif isinstance(e,h2.events.StreamReset):raise EOFError('Requested h2 stream reset')
                    elif isinstance(e,h2.events.ConnectionTerminated) and (not done or e.error_code):
                        raise EOFError('h2 connection terminated before a successful complete response')
                send(conn.data_to_send())
        else:
            conn=h11.Connection(h11.CLIENT)
            send(conn.send(h11.Request(method='GET',target=path,headers=[('host',host)]+HEADERS)));send(conn.send(h11.EndOfMessage()))
            while True:
                e=conn.next_event()
                if e is h11.NEED_DATA:
                    b=read();append_plain(b);conn.receive_data(b)
                elif isinstance(e,h11.Response):response=[(':status',str(e.status_code))]+[(k.decode(),v.decode()) for k,v in e.headers]
                elif isinstance(e,h11.Data):append_body(e.data)
                elif isinstance(e,h11.EndOfMessage):break
                elif isinstance(e,h11.ConnectionClosed):raise EOFError('Incomplete h1 response')
        statuses=[value for key,value in response if key==':status']
        if statuses!=['200']:
            raise ValueError('Gallery request requires HTTP 200; received '+', '.join(statuses))
        body_complete=counts.copy()
        while not ended and select.select([sock],[],[],.08)[0]:
            receive()
            try:
                b=tls.read(65536)
                if not b:break
            except (ssl.SSLWantReadError,ssl.SSLEOFError):pass
        before_close=counts.copy()
        result={'url':'https://'+host+'/','ip':ip,'local_ip':local_ip,'openssl':ssl.OPENSSL_VERSION,**tls_metadata,'http':negotiated or 'http/1.1',
            'keyshare_group_ids':keyshares,'certificate_verified':True,'tls_handshake_messages':messages,
            'response_headers':[(k,'[redacted]' if k=='set-cookie' else v) for k,v in response],
            'body_bytes':len(body),'body_sha256':hashlib.sha256(body).hexdigest(),
            'tls_through_body_complete':body_complete,'tls_before_client_close':before_close,
            'response_http_plain_bytes':len(response_plain),'session_reused':tls.session_reused}
        if negotiated=='h2':
            b=bytes(response_plain);frames=[]
            while len(b)>=9:
                n=int.from_bytes(b[:3],'big')
                if len(b)<9+n:break
                frames.append({'type':b[3],'stream':int.from_bytes(b[5:9],'big')&0x7fffffff,'payload_bytes':n});b=b[9+n:]
            result['response_http2_frames']=frames
            # A TLS read can contain stream completion followed by part of a
            # control frame. Count those bytes without inventing a complete frame.
            result['response_http2_trailing_partial_bytes']=len(b)
        encoding=','.join(value for key,value in response if key=='content-encoding') or 'identity'
        decoded=decode_body(bytes(body),encoding)
        result['decoded_body_bytes']=len(decoded)
        try:tls.unwrap()
        except (ssl.SSLWantReadError,ssl.SSLError):pass
        try:flush()
        except OSError:pass
    finally:
        if sock is not None:sock.close()
    check_progress()
    encoding=','.join(value for key,value in response if key=='content-encoding') or 'identity'
    decoded=decode_body(bytes(body),encoding)
    result['decoded_body_bytes']=len(decoded)
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

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--ca',default='/fixture/root.pem');p.add_argument('--encoding',required=True);a=p.parse_args()
 result=measure('tomkimberlin.com',8443,a.ca,Path('/fixture/public/index.html').read_bytes(),a.encoding)
 result['client']={'python':platform.python_version(),'openssl':ssl.OPENSSL_VERSION,'h2':h2.__version__,'h11':h11.__version__,'brotli':brotli.__version__,'zstandard':zstandard.__version__}
 result['probe_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
 print(json.dumps(result))
