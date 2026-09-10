import socket,struct,json,sys
name=sys.argv[1];out=sys.argv[2];reports=[]
for qtype in (1,28,65):
 qid=0x7210+qtype;q=struct.pack('!6H',qid,0x0100,1,0,0,0)+b''.join(bytes([len(p)])+p.encode() for p in name.split('.'))+b'\0'+struct.pack('!HH',qtype,1)
 s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(10);s.sendto(q,('1.1.1.1',53));r,_=s.recvfrom(4096);s.close();assert int.from_bytes(r[:2],'big')==qid
 reports.append({'type':qtype,'query_bytes':len(q),'response_bytes':len(r),'ipv4_udp_bytes':len(q)+len(r)+56,'answer_count':int.from_bytes(r[6:8],'big'),'flags':r[2:4].hex()})
open(out,'w').write(json.dumps({'host':name,'resolver':'1.1.1.1','edns':False,'dnssec':False,'queries':reports},indent=2)+'\n');print(reports)
