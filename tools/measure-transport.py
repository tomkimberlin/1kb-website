"""Count a controlled HTTPS exchange. Never records TLS secrets or cookies."""
import argparse, hashlib, json, socket, ssl, time, select
from pathlib import Path
from collections import Counter
import h2.connection,h2.config,h2.events
from probe_response import ipv4_address, validate_brotli_response, report_headers, require_distinct_report

if not __debug__:
 raise RuntimeError('Transport measurement requires Python assertions; remove -O or PYTHONOPTIMIZE')

p=argparse.ArgumentParser();p.add_argument('--host',default='tomkimberlin.com');p.add_argument('--ip',type=ipv4_address);p.add_argument('--port',type=int,default=443);p.add_argument('--out',required=True);p.add_argument('--minimal',action='store_true');p.add_argument('--single',action='store_true');p.add_argument('--tls12',action='store_true');p.add_argument('--source-port',type=int,default=0);p.add_argument('--ca');p.add_argument('--insecure',action='store_true');p.add_argument('--expected-body',type=Path,default=Path(__file__).resolve().parents[1]/'public/index.html.br');a=p.parse_args()
try:require_distinct_report(a.out,[__file__,Path(__file__).with_name('probe_response.py'),a.expected_body,*([a.ca] if a.ca else [])])
except ValueError as error:p.error(str(error))
expected_body=a.expected_body.read_bytes()
a.ip=a.ip or socket.gethostbyname(a.host)
context=ssl.create_default_context(cafile=a.ca);context.set_alpn_protocols(['h2']);
if a.insecure:context.check_hostname=False;context.verify_mode=ssl.CERT_NONE
if a.tls12:context.maximum_version=ssl.TLSVersion.TLSv1_2
reports=[]
for connection_index in range(2):
 messages=[]
 def msg(sslobj,direction,version,content_type,msg_type,data):
  if int(content_type)==22: messages.append({'direction':direction,'type':int(msg_type),'bytes':len(data)})
 context._msg_callback=msg
 incoming,outgoing=ssl.MemoryBIO(),ssl.MemoryBIO();tls=context.wrap_bio(incoming,outgoing,server_side=False,server_hostname=a.host,session=session if connection_index else None)
 with socket.socket() as sock:
  deadline=time.monotonic()+15
  sock.settimeout(15)
  if a.source_port:sock.bind(('0.0.0.0',a.source_port+connection_index))
  sock.connect((a.ip,a.port));wire={'sent':0,'received':0};blobs={'sent':bytearray(),'received':bytearray()};phase='handshake';snapshots=[]
  def remaining():
   seconds=deadline-time.monotonic()
   if seconds<=0:raise TimeoutError('HTTP/2 '+phase+' exceeded its deadline')
   return seconds
  def flush():
   while outgoing.pending:
    b=outgoing.read();sock.settimeout(remaining());sock.sendall(b);wire['sent']+=len(b);blobs['sent'].extend(b)
  def receive():
   sock.settimeout(remaining())
   b=sock.recv(65536)
   if not b:raise EOFError('Peer closed')
   wire['received']+=len(b);blobs['received'].extend(b);incoming.write(b)
  def send(b):tls.write(b);flush()
  def read():
   while True:
    remaining()
    try:
     b=tls.read(65536)
     remaining()
     if not b:raise EOFError('TLS closed before a complete HTTP/2 response')
     return b
    except ssl.SSLWantReadError:flush();receive()
  while True:
   remaining()
   try:tls.do_handshake();remaining();flush();break
   except ssl.SSLWantReadError:flush();receive()
  snapshots.append({'phase':'handshake_complete',**wire,'time_ns':time.time_ns()});phase='http'
  if tls.selected_alpn_protocol()!='h2':raise RuntimeError('h2 unavailable')
  conn=h2.connection.H2Connection(config=h2.config.H2Configuration(client_side=True,header_encoding='utf-8'));conn.initiate_connection()
  outgoing_plain=bytearray();incoming_plain=bytearray();requests=[]
  for stream_id in ([1] if a.single else [1,3]):
   deadline=time.monotonic()+15;phase=f'response on stream {stream_id}'
   headers=[(':method','GET'),(':scheme','https'),(':authority',a.host),(':path','/'),('accept-encoding','br')]
   if not a.minimal:headers += [('sec-ch-ua','"Chromium";v="145", "Not:A-Brand";v="99"'),('sec-ch-ua-mobile','?0'),('sec-ch-ua-platform','"macOS"'),('upgrade-insecure-requests','1'),('user-agent','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'),('accept','text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'),('sec-fetch-site','none'),('sec-fetch-mode','navigate'),('sec-fetch-user','?1'),('sec-fetch-dest','document'),('accept-language','en-US,en;q=0.9'),('priority','u=0, i')]
   before=wire.copy();start=time.monotonic();conn.send_headers(stream_id,headers,end_stream=True);b=conn.data_to_send();outgoing_plain.extend(b);send(b);body=bytearray();response=[];done=False
   while not done:
    b=read();incoming_plain.extend(b)
    for e in conn.receive_data(b):
     if isinstance(e,(h2.events.StreamReset,h2.events.ConnectionTerminated)):raise RuntimeError('HTTP/2 connection or stream ended before a complete response')
     if isinstance(e,h2.events.ResponseReceived) and e.stream_id==stream_id:response=e.headers
     elif isinstance(e,h2.events.DataReceived) and e.stream_id==stream_id:
      if len(body)+len(e.data)>len(expected_body):raise ValueError(f'HTTP/2 stream {stream_id}: response body exceeds the local Brotli representation')
      body.extend(e.data);conn.acknowledge_received_data(e.flow_controlled_length,e.stream_id)
     elif isinstance(e,h2.events.StreamEnded) and e.stream_id==stream_id:done=True
    b=conn.data_to_send()
    if b:outgoing_plain.extend(b);send(b)
   validate_brotli_response(response,bytes(body),expected_body,f'HTTP/2 stream {stream_id}')
   requests.append({'stream':stream_id,'body_bytes':len(body),'headers':report_headers(response),'tls_bytes_increment':{k:wire[k]-before[k] for k in wire},'elapsed_ms':round((time.monotonic()-start)*1000,2)})
   snapshots.append({'phase':f'response_{stream_id}_complete',**wire,'time_ns':time.time_ns()})
  # Process any immediately available post-handshake messages without blocking long.
  settle_deadline=time.monotonic()+0.5;deadline=settle_deadline;phase='settling'
  while time.monotonic()<settle_deadline and select.select([sock],[],[],min(0.08,max(0,settle_deadline-time.monotonic())))[0]:
   receive()
   try:
    b=tls.read(65536)
    if b:incoming_plain.extend(b);conn.receive_data(b)
   except ssl.SSLWantReadError:pass
  snapshots.append({'phase':'settled_before_close',**wire,'time_ns':time.time_ns()})
  session=tls.session
  def frames(buf,client=False):
   buf=bytes(buf);items=[]
   if client:assert buf[:24]==b'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n';buf=buf[24:]
   while buf:
    assert len(buf)>=9;n=int.from_bytes(buf[:3],'big');assert len(buf)>=9+n
    items.append({'type':buf[3],'flags':buf[4],'stream':int.from_bytes(buf[5:9],'big')&0x7fffffff,'payload_bytes':n,'total_bytes':9+n});buf=buf[9+n:]
   return items
  def records(buf):
   buf=bytes(buf);items=[]
   while buf:
    if len(buf)<5:return items+[{'partial':len(buf)}]
    n=int.from_bytes(buf[3:5],'big')
    if len(buf)<5+n:return items+[{'partial':len(buf)}]
    items.append({'type':buf[0],'payload_bytes':n,'total_bytes':n+5});buf=buf[5+n:]
   return items
  reports.append({'connection':'resumption_attempt' if connection_index else 'cold','openssl':ssl.OPENSSL_VERSION,'tls':tls.version(),'cipher':tls.cipher()[0],'session_reused':tls.session_reused,'local_port':sock.getsockname()[1],'peer_certificate_der_bytes':len(tls.getpeercert(binary_form=True)),'snapshots':snapshots,'tls_bytes_before_close':wire.copy(),'tls_handshake_messages':messages,'tls_records':{k:records(v) for k,v in blobs.items()},'http2_frames':{'sent':frames(outgoing_plain,True),'received':frames(incoming_plain)},'requests':requests})
  try:tls.unwrap()
  except (ssl.SSLWantReadError,ssl.SSLError):pass
  deadline=time.monotonic()+1;phase='closing'
  flush()
Path(a.out).write_text(json.dumps({'host':a.host,'address_family':'IPv4','request_profile':'minimal' if a.minimal else 'representative_chromium_headers','certificate_verification':not a.insecure,'expected_body_bytes':len(expected_body),'expected_body_sha256':hashlib.sha256(expected_body).hexdigest(),'response_validation':'HTTP 200, Brotli encoding and exact local body on every response','cookie_header_values':'redacted','measurements':reports},indent=2)+'\n')
for r in reports:print(json.dumps({k:r[k] for k in ['connection','tls','cipher','session_reused','peer_certificate_der_bytes','snapshots']}))
