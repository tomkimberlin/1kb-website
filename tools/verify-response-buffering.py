"""Verify HTTP/2 response buffering against an isolated fixture server.

Load tools/fixtures/response-buffering.js using the configuration fragments in
response-buffering.conf. Run against the baseline with --out baseline.json,
then against the candidate with --compare baseline.json --out candidate.json.
The comparison includes response status, body hash, resets and connection
termination; timing observations are reported separately. Requires h2.
"""
import argparse,hashlib,json,socket,ssl,time
from pathlib import Path
from probe_response import require_report_outputs
import h2.config,h2.connection,h2.events,h2.settings
if not __debug__:
 raise RuntimeError('Transport verification requires Python assertions; remove -O or PYTHONOPTIMIZE')
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--host',default='tomkimberlin.com');p.add_argument('--ip');p.add_argument('--port',type=int,default=443);p.add_argument('--ca',help='CA PEM for an isolated trusted test server');p.add_argument('--insecure',action='store_true');p.add_argument('--out');p.add_argument('--compare');p.add_argument('--expect-coalesced-records',action='store_true',help='Assert the patched first-response record counts at the 1024-byte boundary');a=p.parse_args()
if a.out:
 inputs=[Path(__file__),Path(__file__).with_name('probe_response.py'),
         Path(__file__).parent/'fixtures/response-buffering.js',Path(__file__).parent/'fixtures/response-buffering.conf']
 inputs += [value for value in (a.ca,a.compare) if value]
 try:require_report_outputs([a.out],inputs)
 except ValueError as error:p.error(str(error))
ctx=ssl.create_default_context(cafile=a.ca);ctx.set_alpn_protocols(['h2'])
if a.insecure:ctx.check_hostname=False;ctx.verify_mode=ssl.CERT_NONE
class Terminal(Exception):pass
class RecordSocket:
 # SSLObject.read returns one TLS plaintext record at a time. The receive size
 # exceeds the TLS record limit, so a small fixture record is never split by
 # this reader. Capture plaintext only; no keys or encrypted session state.
 def __init__(self,raw):
  self.raw=raw;self.incoming=ssl.MemoryBIO();self.outgoing=ssl.MemoryBIO();self.chunks=[]
  self.tls=ctx.wrap_bio(self.incoming,self.outgoing,server_hostname=a.host)
  self.call(self.tls.do_handshake)
 def flush(self):
  data=self.outgoing.read()
  if data:self.raw.sendall(data)
 def call(self,operation):
  while True:
   try:
    value=operation();self.flush();return value
   except ssl.SSLWantReadError:
    self.flush();data=self.raw.recv(65536)
    if not data:raise Terminal('EOF during TLS operation')
    self.incoming.write(data)
 def recv(self,size):
  data=self.call(lambda:self.tls.read(size));self.chunks.append(data);return data
 def sendall(self,data):
  offset=0
  while offset<len(data):offset+=self.call(lambda:self.tls.write(data[offset:]))
 def selected_alpn_protocol(self):return self.tls.selected_alpn_protocol()
 def close(self):self.raw.close()
class Client:
 def __init__(self,zero=False,small_receive_buffer=False,record=False):
  raw=socket.socket();raw.settimeout(5)
  if small_receive_buffer:raw.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,1024)
  raw.connect((a.ip or a.host,a.port));self.tls=RecordSocket(raw) if record else ctx.wrap_socket(raw,server_hostname=a.host)
  assert self.tls.selected_alpn_protocol()=='h2'
  self.h=h2.connection.H2Connection(config=h2.config.H2Configuration(client_side=True,header_encoding='utf-8'))
  self.h.initiate_connection();self.streams={};self.terminal=None
  if zero:self.h.update_settings({h2.settings.SettingCodes.INITIAL_WINDOW_SIZE:0})
 def request(self,path,method='GET'):
  sid=self.h.get_next_available_stream_id();self.streams[sid]={'body':bytearray(),'headers':None,'ended':False,'reset':None,'start':time.monotonic(),'first_data':None,'header_time':None,'end_time':None}
  self.h.send_headers(sid,[(':method',method),(':scheme','https'),(':authority',a.host),(':path','/_coalesce/'+path)],end_stream=True);return sid
 def send(self):
  data=self.h.data_to_send()
  if data:self.tls.sendall(data)
 def pump(self,auto_ack=True):
  data=self.tls.recv(65536)
  if not data:self.terminal={'kind':'eof'};raise Terminal('eof')
  for e in self.h.receive_data(data):
   if isinstance(e,h2.events.ConnectionTerminated):
    self.terminal={'kind':'goaway','error_code':int(e.error_code)};raise Terminal('goaway')
   sid=getattr(e,'stream_id',None);s=self.streams.get(sid)
   if isinstance(e,h2.events.ResponseReceived):s['headers']=dict(e.headers);s['header_time']=time.monotonic()-s['start']
   elif isinstance(e,h2.events.DataReceived):
    if s['first_data'] is None:s['first_data']=time.monotonic()-s['start']
    s['body'].extend(e.data)
    if auto_ack:self.h.acknowledge_received_data(e.flow_controlled_length,e.stream_id)
   elif isinstance(e,h2.events.StreamEnded):s['ended']=True;s['end_time']=time.monotonic()-s['start']
   elif isinstance(e,h2.events.StreamReset):s['reset']=int(e.error_code)
  self.send()
 def until(self,predicate,auto_ack=True):
  deadline=time.monotonic()+10
  while not predicate():
   assert time.monotonic()<deadline,'test deadline exceeded'
   self.pump(auto_ack)
 def result(self,sid,status,body):
  s=self.streams[sid];assert s['reset'] is None,s;assert s['ended'],s;assert int(s['headers'][':status'])==status,s;assert bytes(s['body'])==body,(sid,len(s['body']),len(body))
 def outcome(self,sid):
  s=self.streams[sid]
  return {'status':int(s['headers'][':status']) if s['headers'] else None,'bytes':len(s['body']),'sha256':hashlib.sha256(s['body']).hexdigest(),'ended':s['ended'],'reset':s['reset']}
 def close(self):self.tls.close()
checks=[];outcomes={};timings={};threshold_records={}
def record(name,c,sid):
 checks.append(name);outcomes[name]=c.outcome(sid)
 s=c.streams[sid];timings[name]={key:round(s[key],4) if s[key] is not None else None for key in ('header_time','first_data','end_time')}
c=Client()
for index,(path,method,status,body) in enumerate([('small','GET',200,b's'*318),('small','GET',200,b's'*318),('small','HEAD',200,b''),('empty','GET',200,b''),('redirect','GET',301,b''),('no-body','GET',200,b''),('headonly','GET',204,b''),('large','GET',200,b'L'*200000),('slow','GET',200,b's'*318)]):
 sid=c.request(path,method);c.send();c.until(lambda:c.streams[sid]['ended']);c.result(sid,status,body);record(f'{index}:{path}:{method}',c,sid)
c.close()
# The coalescing cutoff matters on the first response of a fresh TLS socket.
# Warm responses can already share a record through nginx's ordinary buffer.
for size in (1023,1024,1025):
 c=Client(record=True);sid=c.request('threshold-'+str(size));c.send();c.until(lambda:c.streams[sid]['ended']);c.result(sid,200,b't'*size)
 response_records=[]
 for chunk in c.tls.chunks:
  offset=0;types=[]
  while offset<len(chunk):
   assert offset+9<=len(chunk),'Fixture frame header crosses a TLS record'
   length=int.from_bytes(chunk[offset:offset+3],'big');stream=int.from_bytes(chunk[offset+5:offset+9],'big')&0x7fffffff
   assert offset+9+length<=len(chunk),'Fixture frame crosses a TLS record'
   if stream==sid:types.append(chunk[offset+3])
   offset+=9+length
  if types:response_records.append(types)
 if a.expect_coalesced_records:assert response_records==([[1,0]] if size<=1024 else [[1],[0]]),(size,response_records)
 threshold_records[str(size)]=response_records
 name='threshold:'+str(size);record(name,c,sid);c.close()
# Zero stream-window credit must not block HEADERS or connection control frames.
c=Client(zero=True);sid=c.request('small');c.send();c.until(lambda:c.streams[sid]['headers'] is not None,False)
assert not c.streams[sid]['body'] and not c.streams[sid]['ended'];assert c.streams[sid]['header_time']<3
c.h.increment_flow_control_window(318,stream_id=sid);c.send();c.until(lambda:c.streams[sid]['ended']);c.result(sid,200,b's'*318);record('zero-window:resume',c,sid);c.close()
# Cancel a blocked response and reuse the same connection with fresh credit.
c=Client(zero=True);blocked=c.request('small');c.send();c.until(lambda:c.streams[blocked]['headers'] is not None,False)
assert not c.streams[blocked]['body'];c.h.reset_stream(blocked,error_code=8);c.send()
sid=c.request('small');c.h.increment_flow_control_window(318,stream_id=sid);c.send();c.until(lambda:c.streams[sid]['ended']);c.result(sid,200,b's'*318);record('zero-window:reset-and-reuse',c,sid);c.close()
# Exhaust the connection window as well as one large stream's window. A new
# small stream still has stream credit, but its HEADERS must leave while DATA
# waits for connection credit. Granting 318 bytes must complete that stream
# without granting the blocked large stream any additional stream credit.
c=Client();blocked=c.request('large');c.send();c.until(lambda:c.h.inbound_flow_control_window==0,False)
assert len(c.streams[blocked]['body'])==65535 and not c.streams[blocked]['ended']
sid=c.request('small');c.send();c.until(lambda:c.streams[sid]['headers'] is not None,False)
assert not c.streams[sid]['body'] and not c.streams[sid]['ended'];assert c.streams[sid]['header_time']<3
c.h.increment_flow_control_window(318);c.send();c.until(lambda:c.streams[sid]['ended'],False);c.result(sid,200,b's'*318)
assert len(c.streams[blocked]['body'])==65535 and not c.streams[blocked]['ended']
record('connection-window:headers-and-resume',c,sid);c.h.reset_stream(blocked,error_code=8);c.send();c.close()
# One input burst mixes normal, large, HEAD, and empty responses.
c=Client();spec=[('large','GET',200,b'L'*200000),('small','GET',200,b's'*318),('small','HEAD',200,b''),('empty','GET',200,b'')]
sids=[c.request(path,method) for path,method,_,_ in spec];c.send();c.until(lambda:all(c.streams[sid]['ended'] for sid in sids))
for i,(sid,(_,_,status,body)) in enumerate(zip(sids,spec)):c.result(sid,status,body);record(f'concurrent:{i}',c,sid)
c.close()
# Small receive window + delayed reader stress. A staging listen sndbuf=4k
# makes server socket backpressure likely; this test itself does not
# claim to prove a kernel EAGAIN without server debug/packet evidence.
c=Client(small_receive_buffer=True);sids=[c.request('small') for _ in range(64)];c.send();time.sleep(0.3)
c.until(lambda:all(c.streams[sid]['ended'] for sid in sids))
for sid in sids:c.result(sid,200,b's'*318)
outcomes['delayed-reader:64-small-responses']={'responses':64,'bytes':sum(len(c.streams[s]['body']) for s in sids),'passed':True};checks.append('delayed-reader:64-small-responses');c.close()
# Streaming headers must precede completion; small r.send() chunks may buffer.
c=Client();sid=c.request('stream');c.send();c.until(lambda:c.streams[sid]['ended']);c.result(sid,200,b'firstlast');s=c.streams[sid]
assert s['end_time']-s['header_time']>=0.4,('stream headers delayed until finish',s)
record('streaming:headers-before-finish',c,sid);c.close()
# Record exact error response/reset/connection terminal, then test server health.
c=Client();sid=c.request('header-error');c.send()
try:c.until(lambda:c.streams[sid]['ended'] or c.streams[sid]['reset'] is not None)
except Terminal:pass
except (ConnectionResetError,ssl.SSLEOFError):c.terminal={'kind':'socket-reset'}
record('header-filter-error',c,sid);outcomes['header-filter-error']['connection_terminal']=c.terminal
if c.terminal is None:
 reuse=c.request('small');c.send();c.until(lambda:c.streams[reuse]['ended']);c.result(reuse,200,b's'*318);record('header-filter-error:same-connection-reuse',c,reuse)
c.close()
c=Client();sid=c.request('small');c.send();c.until(lambda:c.streams[sid]['ended']);c.result(sid,200,b's'*318);record('header-filter-error:new-connection-health',c,sid);c.close()
report={'passed':True,'checks':checks,'outcomes':outcomes,'timings_seconds':timings,'threshold_records':{'expectation_enforced':a.expect_coalesced_records,'frames_per_record':threshold_records}}
if a.compare:
 baseline=json.loads(Path(a.compare).read_text())
 assert baseline['outcomes']==outcomes,json.dumps({'baseline':baseline['outcomes'],'candidate':outcomes},indent=2)
 report['identical_semantics_to_baseline']=True
if a.out:Path(a.out).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
