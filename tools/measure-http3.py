import argparse,asyncio,json,ssl,time
from pathlib import Path
from aioquic.asyncio.client import connect
from aioquic.asyncio.protocol import QuicConnectionProtocol
from aioquic.h3.connection import H3Connection,H3_ALPN
from aioquic.h3.events import HeadersReceived,DataReceived
from aioquic.quic.events import ProtocolNegotiated,HandshakeCompleted
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.logger import QuicLogger
p=argparse.ArgumentParser();p.add_argument('--host',default='tomkimberlin.com');p.add_argument('--ip',required=True);p.add_argument('--out',required=True);p.add_argument('--port',type=int,default=443);a=p.parse_args()
class CountingTransport:
 def __init__(self,real,protocol):self.real=real;self.protocol=protocol
 def sendto(self,data,addr=None):self.protocol.record('sent',len(data));self.real.sendto(data,addr)
 def __getattr__(self,n):return getattr(self.real,n)
class Client(QuicConnectionProtocol):
 def __init__(self,*args,**kwargs):
  super().__init__(*args,**kwargs);self.wire={'sent':0,'received':0};self.packets={'sent':0,'received':0};self.datagrams=[];self.snapshots=[];self.http=None;self.waiters={};self.responses={};self.reused=False
 def record(self,direction,n):self.wire[direction]+=n;self.packets[direction]+=1;self.datagrams.append({'direction':direction,'bytes':n})
 def connection_made(self,transport):super().connection_made(CountingTransport(transport,self))
 def datagram_received(self,data,addr):self.record('received',len(data));super().datagram_received(data,addr)
 def snap(self,phase):self.snapshots.append({'phase':phase,'udp_payload':self.wire.copy(),'datagrams':self.packets.copy(),'ipv4_udp_total':{k:self.wire[k]+28*self.packets[k] for k in self.wire}})
 def quic_event_received(self,event):
  if isinstance(event,ProtocolNegotiated):self.http=H3Connection(self._quic)
  if isinstance(event,HandshakeCompleted):self.reused=event.session_resumed;self.snap('handshake_complete')
  if self.http:
   for e in self.http.handle_event(event):
    if isinstance(e,(HeadersReceived,DataReceived)) and e.stream_id in self.responses:
     r=self.responses[e.stream_id]
     if isinstance(e,HeadersReceived):r['headers']=[(k.decode(),v.decode()) for k,v in e.headers]
     else:r['body']+=e.data
     if e.stream_ended and not self.waiters[e.stream_id].done():self.waiters[e.stream_id].set_result(r)
 async def get(self):
  sid=self._quic.get_next_available_stream_id();self.responses[sid]={'body':b'','headers':[]};self.waiters[sid]=asyncio.get_running_loop().create_future()
  headers=[(b':method',b'GET'),(b':scheme',b'https'),(b':authority',a.host.encode()),(b':path',b'/'),(b'accept-encoding',b'br'),(b'user-agent',b'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'),(b'accept',b'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'),(b'sec-fetch-dest',b'document'),(b'sec-fetch-mode',b'navigate'),(b'sec-fetch-site',b'none'),(b'sec-fetch-user',b'?1'),(b'accept-language',b'en-US,en;q=0.9'),(b'priority',b'u=0, i')]
  self.http.send_headers(sid,headers,end_stream=True);self.transmit();r=await asyncio.wait_for(self.waiters[sid],15);self.snap(f'response_{sid}_complete');assert r['body']==(Path(__file__).resolve().parents[1]/'public/index.html.br').read_bytes();return {'stream':sid,'body_bytes':len(r['body']),'headers':r['headers']}
async def main():
 ticket=None;reports=[]
 def save(t):nonlocal ticket;ticket=t
 for i in range(2):
  log=QuicLogger();config=QuicConfiguration(is_client=True,alpn_protocols=H3_ALPN,server_name=a.host,session_ticket=ticket,quic_logger=log)
  async with connect(a.ip,a.port,configuration=config,create_protocol=Client,session_ticket_handler=save) as c:
   responses=[await c.get(),await c.get()];await asyncio.sleep(.06);c.snap('after_ack_flush')
   reports.append({'connection':'resumption_attempt' if i else 'cold','session_reused':c.reused,'snapshots':c.snapshots,'datagrams':c.datagrams,'responses':responses,'h3_events':[e for t in log.to_dict()['traces'] for e in t.get('events',[]) if 'http' in e.get('name','')]})
 Path(a.out).write_text(json.dumps({'host':a.host,'protocol':'h3','scope':'Aioquic client with classical key exchange; IPv4/UDP count includes 28 bytes per datagram, excludes DNS and link-layer overhead.','measurements':reports},indent=2)+'\n')
 for r in reports:print(json.dumps({k:r[k] for k in ['connection','session_reused','snapshots']}))
asyncio.run(main())
