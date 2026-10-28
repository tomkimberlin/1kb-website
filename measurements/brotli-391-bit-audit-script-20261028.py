#!/usr/bin/env python3.13
"""Read each stream's raw bits and independently verify trees and data codes.

This is an intentionally narrow parser for the captured single-metablock
case. It does not decompress Brotli copies or static dictionary transforms;
raw literal bytes are compared with the input, and parsed copy-code fields and
distance fields are compared to the independently captured control commands.
"""
import base64
from collections import Counter
from hashlib import sha256
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parent
STUDY=ROOT/'study'
ORDER=(1,2,3,4,0,5,17,6,16,7,8,9,10,11,12,13,14,15)
STATIC={'00':0,'1110':1,'110':2,'01':3,'10':4,'1111':5}
INSBASE=(0,1,2,3,4,5,6,8,10,14,18,26,34,50,66,98,130,194,322,578,1090,2114,6210,22594)
INSEXTRA=(0,0,0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,7,8,9,10,12,14,24)
COPYBASE=(2,3,4,5,6,7,8,9,10,12,14,18,22,30,38,54,70,102,134,198,326,582,1094,2118)
COPYEXTRA=(0,0,0,0,0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,7,8,9,10,24)
# Prefix groups 0-1 reuse the most recent distance. Others map to
# insert-length/copy-length code groups. The offset within each group is
# three insert-code low bits followed by three copy-code low bits.
GROUPS=((0,0),(0,1),(0,0),(0,1),(1,0),(1,1),(0,2),(2,0),(1,2),(2,1),(2,2))

def digest(data):return sha256(data).hexdigest()

class Reader:
 def __init__(self,data):self.data=data;self.pos=0
 def bit(self):
  assert self.pos<len(self.data)*8, ('truncated at bit',self.pos)
  bit=(self.data[self.pos//8]>>(self.pos%8))&1
  self.pos+=1
  return bit
 def uint(self,n):return sum(self.bit()<<i for i in range(n))
 def symbol(self,table,limit=15):
  code=0
  for d in range(1,limit+1):
   code=(code<<1)|self.bit()
   if (d,code) in table:return table[(d,code)]
  raise AssertionError(('bad canonical code at bit',self.pos))
 def static(self):
  bits=''
  for _ in range(4):
   bits+=str(self.bit())
   if bits in STATIC:return STATIC[bits]
  raise AssertionError(('bad static length code',bits))

def table(depths,max_depth):
 assert all(0<=d<=max_depth for d in depths)
 active=sum(d>0 for d in depths)
 assert active>1
 assert sum(1<<(max_depth-d) for d in depths if d)==1<<max_depth
 counts=[0]*(max_depth+1)
 for d in depths:
  if d: counts[d]+=1
 nextcode=[0]*(max_depth+1);code=0
 for d in range(1,max_depth+1):
  code=(code+counts[d-1])<<1;nextcode[d]=code
 entries={}
 for sym,d in enumerate(depths):
  if d:
   assert nextcode[d] < (1<<d)
   entries[d,nextcode[d]]=sym;nextcode[d]+=1
 assert len(entries)==active
 return entries

def parse_tree(reader,alphabet):
 start=reader.pos;skip=reader.uint(2);assert skip in (0,2,3)
 secondary=[0]*18;space=32
 for i in range(skip,18):
  d=reader.static();secondary[ORDER[i]]=d
  if d:space-=32>>d
  assert space>=0
  if not space:break
 assert not space
 secondary_end=reader.pos
 t=table(secondary,5)
 depths=[];tokens=[];previous=8;repeat=0;value0=None;space=32768
 while space:
  sym=reader.symbol(t,5)
  if sym<16:
   extra=0;repeat=0;depths.append(sym)
   if sym:previous=sym;space-=32768>>sym
  else:
   width=2 if sym==16 else 3;extra=reader.uint(width)
   value=previous if sym==16 else 0
   if value0!=value:repeat=0
   value0=value;old=repeat
   repeat=((repeat-2)<<width if repeat else 0)+extra+3
   delta=repeat-old;assert delta>0
   depths.extend([value]*delta)
   if value:space-=delta*(32768>>value)
  assert space>=0 and len(depths)<=alphabet
  tokens.append([sym,extra])
 depths += [0]*(alphabet-len(depths))
 return {'start':start,'end':reader.pos,'secondaryEnd':secondary_end,
         'secondary':secondary,'depths':depths,'tokens':tokens,'table':table(depths,15)}

def preamble(reader):
 assert reader.uint(1)==0                 # WBITS 16
 assert reader.uint(1)==1                 # ISLAST
 assert reader.uint(1)==0                 # ISEMPTY
 assert reader.uint(2)==0                 # MNIBBLES 4
 length=reader.uint(16)+1;assert length==1040
 assert [reader.uint(1) for _ in range(3)]==[0,0,0] # one block type each
 postfix=reader.uint(2);direct=reader.uint(4)<<postfix
 mode=reader.uint(2)
 assert reader.uint(1)==0 and reader.uint(1)==0 # one tree in both context maps
 assert reader.pos==34
 return {'windowBits':16,'isLast':1,'uncompressedLength':length,
         'blockTypeCounts':[1,1,1],'distancePostfix':postfix,'distanceDirect':direct,'literalContextMode':mode}

def command_lengths(reader,prefix):
 group=prefix//64;assert group<len(GROUPS)
 ig,cg=GROUPS[group];inscode=ig*8+(prefix%64)//8;copycode=cg*8+prefix%8
 ins=INSBASE[inscode]+reader.uint(INSEXTRA[inscode])
 copy=COPYBASE[copycode]+reader.uint(COPYEXTRA[copycode])
 return ins,copy

def parse_payload(reader,trees,source,commands,postfix,direct):
 counts=[Counter(),Counter(),Counter()];items=[];pos=0
 for index,(expected_insert,raw_copy,expected_extra,expected_prefix,expected_dist) in enumerate(commands):
  prefix=reader.symbol(trees[1]['table']);counts[1][prefix]+=1
  ins,copycode=command_lengths(reader,prefix)
  ncopy=raw_copy&((1<<25)-1);modifier=raw_copy>>25
  signed_modifier=modifier if modifier<64 else modifier-128
  assert (prefix,ins,copycode)==(expected_prefix,expected_insert,ncopy+signed_modifier), (index,prefix,ins,copycode)
  literals=[]
  for _ in range(ins):
   lit=reader.symbol(trees[0]['table']);counts[0][lit]+=1;literals.append(lit)
  assert bytes(literals)==source[pos:pos+ins]
  pos+=ins;pos+=ncopy;assert pos<=len(source)
  dist=None
  if ncopy and prefix>=128:
   code=reader.symbol(trees[2]['table']);counts[2][code]+=1
   nbits=0 if code<16+direct else ((code-16-direct)>>(postfix+1))+1
   extra=reader.uint(nbits)
   assert (code,nbits,extra)==(expected_dist&1023,expected_dist>>10,expected_extra), (index,code,nbits,extra,expected_dist,expected_extra)
   dist=[code,nbits,extra]
  items.append([prefix,ins,copycode,ncopy,dist,literals])
 assert pos==len(source)
 return counts,items

report_bytes=(STUDY/'combined-run1.json').read_bytes();r=json.loads(report_bytes)
cap_bytes=(STUDY/'capture.json').read_bytes();cap=json.loads(cap_bytes)
source=(STUDY/'source.html').read_bytes()
control=base64.b64decode(r['controlBase64'],validate=True)
candidate=base64.b64decode(r['candidateBase64'],validate=True)
assert digest(source)==r['sourceSha256']==cap['sourceSha256']
assert digest(control)==r['controlSha256']==cap['controlSha256']
assert digest(candidate)==r['candidateSha256'] and candidate==(STUDY/'combined-run1.br').read_bytes()
assert r['commands']==cap['commands'] and r['trees']==cap['trees']
assert len(r['commands'])==101
results={};parsed_items={};raw_counts={}
for name,data in [('control',control),('candidate',candidate)]:
 reader=Reader(data);head=preamble(reader);trees=[]
 for i,n in enumerate((256,704,65)):
  tree=parse_tree(reader,n);trees.append(tree)
  wanted=cap['trees'][i]['depths'] if name=='control' else r['primaryDepths'][i]
  assert tree['depths']==wanted
  if name=='control':assert tree['secondary']==cap['trees'][i]['secondary']
  assert tree['end']-tree['start']==(cap['trees'][i]['headerBits'] if name=='control' else r['headerBits'][i])
 payload_start=reader.pos
 counts,items=parse_payload(reader,trees,source,r['commands'],head['distancePostfix'],head['distanceDirect'])
 for i,c in enumerate(counts):assert [c[x] for x in range(len(cap['trees'][i]['actualCounts']))]==cap['trees'][i]['actualCounts']
 assert reader.pos==len(data)*8==r['controlMeaningfulBits' if name=='control' else 'candidateMeaningfulBits']
 results[name]={'sha256':digest(data),'bytes':len(data),'preamble':head,
                'headers':[{'start':t['start'],'end':t['end'],'bits':t['end']-t['start'],
                            'secondaryBits':t['secondaryEnd']-t['start'],
                            'active':sum(d>0 for d in t['depths']),
                            'maxDepth':max(t['depths']),
                            'kraftUnits15':sum(32768>>d for d in t['depths'] if d),
                            'secondaryActive':sum(d>0 for d in t['secondary'])} for t in trees],
                'payloadStart':payload_start,'payloadBits':reader.pos-payload_start,
                'commandCount':len(items),'literalCount':sum(counts[0].values()),
                'distanceCount':sum(counts[2].values()),'meaningfulBits':reader.pos,
                'endPaddingBits':len(data)*8-reader.pos}
 parsed_items[name]=items;raw_counts[name]=counts
assert parsed_items['control']==parsed_items['candidate']
assert raw_counts['control']==raw_counts['candidate']
assert results['control']['preamble']==results['candidate']['preamble']
for i in range(3):
 old=cap['trees'][i]['depths'];new=r['primaryDepths'][i]
 diff=[j for j,(a,b) in enumerate(zip(old,new)) if a!=b]
 if i==0:assert diff==[49,119] and (old[49],old[119])==(new[119],new[49])
 elif i==1:assert diff==[180,208] and (old[180],old[208])==(new[208],new[180])
 else:assert not diff
result={'scriptSha256':digest(Path(__file__).read_bytes()),'reportSha256':digest(report_bytes),
        'captureSha256':digest(cap_bytes),'sourceSha256':digest(source),'streams':results,
        'controlAndCandidateCanonicalSymbolsAndCommandFieldsMatch':True,
        'allPrimaryCodeSpacesFullAndDepthsMatch':True,
        'actualDecodedCodeCountsMatchCapturedHistograms':True,
        'limitation':'This narrow reader compares parsed copy fields, not dictionary transform execution; the fully consuming Node and stock C decoders supply end-to-end validation.'}
(ROOT/'bit-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
