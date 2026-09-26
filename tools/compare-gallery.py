"""Controlled cold document exchanges, with metadata-only capture of owned TCP flows.

Not a browser load: excludes subresources, favicon discovery, redirects and browser DNS.
Requires Linux raw sockets and the configured capture interface (br0).
The measurement container provides an OpenSSL build with certificate compression enabled.
"""
import argparse, hashlib, io, json, math, select, socket, ssl, struct, threading, time, zlib
from pathlib import Path
from urllib.parse import urlsplit
import brotli, h11, h2.config, h2.connection, h2.events, zstandard
from dns_measurement import measure_query
from probe_response import require_report_outputs

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

# Caps apply to each encoded/decoded layer and to the entire TLS exchange,
# including headers/control frames. Per-socket timeouts alone allow endless drips.
MAX_BODY_BYTES = 1 << 20
MAX_ZSTD_WINDOW_BYTES = 1 << 20  # Pinned binding forwards bytes to libzstd, despite its KiB docstring.
MAX_HTTP_PLAIN_BYTES = 2 << 20
MAX_TLS_BYTES = 4 << 20
EXCHANGE_SECONDS = 30


def require_bounded_brotli():
    try:
        brotli.Decompressor().process(b'', output_buffer_limit=1)
    except TypeError as error:
        raise RuntimeError('Gallery decoding requires brotli >= 1.2.0') from error


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


def tcp_packet(frame, peer, port, local_ip):
    """Return metadata for an owned unfragmented IPv4/TCP flow, without payload.

    Ignore unrelated/undecodable traffic. Once ports identify the owned flow,
    malformed or truncated headers fail the measurement instead of undercounting.
    """
    if len(frame) < 34 or frame[12:14] != b'\x08\x00':
        return None
    packet = frame[14:]
    ihl = (packet[0] & 15) * 4
    if packet[0] >> 4 != 4 or ihl < 20 or len(packet) < ihl + 4 or packet[9] != 6:
        return None
    source = socket.inet_ntoa(packet[12:16])
    destination = socket.inet_ntoa(packet[16:20])
    source_port, destination_port = struct.unpack('!HH', packet[ihl:ihl + 4])
    if source == local_ip and destination == peer and source_port == port and destination_port == 443:
        direction = 'sent'
    elif source == peer and destination == local_ip and destination_port == port and source_port == 443:
        direction = 'received'
    else:
        return None
    length = int.from_bytes(packet[2:4], 'big')
    if int.from_bytes(packet[6:8], 'big') & 0x3fff:
        raise ValueError('Fragmented IPv4 packet in measured TCP flow')
    if length < ihl + 20 or length > len(packet):
        raise ValueError('Truncated or invalid IPv4 length in measured TCP flow')
    thl = (packet[ihl + 12] >> 4) * 4
    if thl < 20 or ihl + thl > length:
        raise ValueError('Invalid TCP header length in measured flow')
    payload = length - ihl - thl
    segments = max(1, math.ceil(payload / (1500 - ihl - thl)))
    return {'direction': direction, 'ip_bytes': length, 'tcp_payload_bytes': payload,
            'ip_header_bytes': ihl, 'tcp_header_bytes': thl, 'flags': packet[ihl + 13],
            'seq': int.from_bytes(packet[ihl + 4:ihl + 8], 'big'),
            'estimated_segments_at_1500_mtu': segments,
            'ip_bytes_at_1500_mtu': length + (segments - 1) * (ihl + thl)}


def capture_packets(raw, stop, packets, errors, peer, port, local_ip):
    try:
        while not stop.is_set():
            try:
                frame = raw.recv(65535 + 64)  # IPv4 maximum plus Ethernet header.
            except TimeoutError:
                continue
            packet = tcp_packet(frame, peer, port, local_ip)
            if packet is not None:
                packets.append(packet)
    except Exception as error:
        errors.append(error)
        stop.set()


def dns(host):
    return [{'qtype':typ,**measure_query(host,typ,0x7300+typ)} for typ in (1,28,65)]

def url_parts(url):
    u=urlsplit(url)
    if u.scheme != 'https' or not u.hostname or u.port not in (None, 443) or u.username is not None:
        raise ValueError('Gallery URLs must use HTTPS on port 443 without credentials')
    host=u.hostname.encode('idna').decode('ascii')
    path=(u.path or '/') + ('?' + u.query if '?' in url.split('#', 1)[0] else '')
    return host,path


def validate_outputs(urls,outdir):
    outputs=[outdir/'results.json']+[outdir/(url_parts(url)[0]+'.html') for url in urls]
    inputs=[Path(__file__),Path(__file__).with_name('dns_measurement.py'),Path(__file__).with_name('probe_response.py')]
    ca=ssl.get_default_verify_paths().cafile
    if ca:inputs.append(Path(ca))
    require_report_outputs(outputs,inputs)


def run(url,port,outdir,curve=None):
    validate_outputs([url],outdir)
    host,path=url_parts(url);ip=socket.gethostbyname(host)
    require_bounded_brotli()
    dns_results=dns(host)
    packets=[];capture_errors=[];stop=threading.Event()
    deadline=time.monotonic()+EXCHANGE_SECONDS
    def check_progress():
        if capture_errors:
            raise RuntimeError('Packet capture failed: '+str(capture_errors[0])) from capture_errors[0]
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('TLS/HTTP exchange deadline exceeded')
        return remaining
    raw=sock=thread=None;started=False
    try:
        raw=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(3));raw.bind(('br0',0));raw.settimeout(.1)
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
        sock.settimeout(min(15,check_progress()));sock.connect((ip,443))
        local_ip=sock.getsockname()[0]
        # The bound raw socket already queues SYN/handshake packets. Start its
        # reader once connect has selected the actual local IPv4 address, so
        # another host using the same source port cannot contaminate the count.
        thread=threading.Thread(target=capture_packets,args=(raw,stop,packets,capture_errors,ip,port,local_ip))
        thread.start();started=True
        while True:
            check_progress()
            try:tls.do_handshake();flush();break
            except ssl.SSLWantReadError:flush();receive()
        negotiated=tls.selected_alpn_protocol();response=[];body=bytearray();response_plain=bytearray()
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
        result={'url':url,'ip':ip,'local_ip':local_ip,'openssl':ssl.OPENSSL_VERSION,**tls_metadata,'http':negotiated or 'http/1.1',
            'keyshare_group_ids':keyshares,'certificate_verified':True,'tls_handshake_messages':messages,
            'response_headers':[(k,'[redacted]' if k=='set-cookie' else v) for k,v in response],
            'body_bytes':len(body),'body_sha256':hashlib.sha256(body).hexdigest(),
            'tls_through_body_complete':body_complete,'tls_before_client_close':before_close,
            'response_http_plain_bytes':len(response_plain),'dns_queries':dns_results}
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
        try:
            if sock is not None:sock.close()
            if started:time.sleep(.25)
        finally:
            stop.set()
            if started:thread.join()
            if raw is not None:raw.close()
    check_progress()
    if not packets:raise RuntimeError('No packets captured for measured TCP flow')
    (outdir/(host+'.html')).write_bytes(decoded)
    result['packets']=packets
    result['observed_ipv4_tcp_bytes']=sum(p['ip_bytes'] for p in packets)
    result['estimated_ipv4_tcp_bytes_1500_mtu']=sum(p['ip_bytes_at_1500_mtu'] for p in packets)
    result['dns_ipv4_udp_bytes']=sum(d['ipv4_udp_bytes'] for d in dns_results)
    result['estimated_tcp_plus_dns_bytes']=result['estimated_ipv4_tcp_bytes_1500_mtu']+result['dns_ipv4_udp_bytes']
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--curve');p.add_argument('--port',type=int,default=46240);p.add_argument('--urls',nargs='*');a=p.parse_args()
    out=Path(a.out);urls=a.urls or URLS
    try:validate_outputs(urls,out)
    except ValueError as error:p.error(str(error))
    out.mkdir(exist_ok=True,parents=True);results=[]
    for i,url in enumerate(urls):
        try:r=run(url,a.port+i,out,a.curve)
        except Exception as e:r={'url':url,'error':str(e)}
        results.append(r);(out/'results.json').write_text(json.dumps({'time_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'request_headers':HEADERS,'forced_curve':a.curve,'results':results},indent=2)+'\n')
        print(json.dumps({k:v for k,v in r.items() if k in ('url','error','body_bytes','decoded_body_bytes','tls_through_body_complete','http','keyshare_group_ids','estimated_tcp_plus_dns_bytes','observed_ipv4_tcp_bytes')}),flush=True)
