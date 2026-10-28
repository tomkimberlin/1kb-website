"""Reproduce one exact standard-DEFLATE candidate; standard Python only.

Usage: python3 reproduce.py --input <1040-byte source> --output-dir <directory>
The header choices are fixed from the bounded search, while the payload is
recomputed using an exhaustive shortest path for that fixed tree.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import platform
import struct
import zlib

SOURCE_SHA='86b1f6f2777fbfe9e98fcbe43456e85c87829ed03c10d8bd911271fd463a277c'
EXPECTED={'raw':'2798bd32bd28c5cf57e002e95e799c4bdeb8237d3a89ee3c950e49141858db55',
          'gz':'c3d75eb558ff097e54ec7e0f180e37869c9b4bfbec301045410413f0ff974fef',
          'deflate':'055a322af0c96ace5f049886e0ac4675b4dc0728cbcef72c48b2667af7235d01'}
ORDER=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]
# Code-length alphabet and its RLE tokens for the winning dynamic tree.
CL=[5,0,0,5,4,3,2,5,4,4,0,0,0,0,0,0,2,4,5]
RLE=[(17,10),(9,1),(18,21),(4,1),(9,1),(16,5),(17,5),(9,1),(6,1),(6,1),
 (6,1),(8,1),(16,3),(16,6),(6,1),(16,3),(5,1),(9,1),(16,6),(16,6),
 (16,6),(16,6),(17,9),(5,1),(6,1),(6,1),(6,1),(4,1),(7,1),(6,1),(5,1),
 (4,1),(8,1),(6,1),(5,1),(16,3),(6,1),(0,1),(5,1),(5,1),(4,1),(6,1),
 (8,1),(16,4),(18,133),(9,1),(6,1),(16,3),(8,1),(16,6),(16,6),(17,3),
 (6,1),(16,4),(4,1),(16,3),(3,1),(16,4),(5,1),(6,1)]
LBASE=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258]
LEXTRA=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0]
DBASE=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577]
DEXTRA=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13]
sha=lambda data:hashlib.sha256(data).hexdigest()

def table(lengths):
    counts=Counter(lengths);counts[0]=0;code=0;nexts={};result={}
    for width in range(1,16):
        code=(code+counts[width-1])<<1;nexts[width]=code
    for sym,width in enumerate(lengths):
        if width:
            result[sym]=(width,nexts[width]);nexts[width]+=1
    return result

def expanded_tree():
    seq=[]
    for sym,count in RLE:
        if sym<=15:
            if count!=1:raise ValueError('invalid literal code length')
            seq.append(sym)
        elif sym==16:
            if not seq or not 3<=count<=6:raise ValueError('invalid repeated code length')
            seq.extend([seq[-1]]*count)
        elif sym==17:
            if not 3<=count<=10:raise ValueError('invalid short zero run')
            seq.extend([0]*count)
        elif sym==18:
            if not 11<=count<=138:raise ValueError('invalid long zero run')
            seq.extend([0]*count)
        else:raise ValueError('invalid header symbol')
    if len(seq)!=293:raise ValueError('unexpected code-length sequence')
    return seq[:274],seq[274:]

def run(src):
    if len(src)!=1040 or sha(src)!=SOURCE_SHA:raise ValueError('input differs from the exact pinned source')
    ll,dd=expanded_tree();n=len(src);first=9
    lcode={}
    for k,lo in enumerate(LBASE):
        hi=LBASE[k+1]-1 if k+1<len(LBASE) else 258
        for length in range(lo,hi+1):lcode[length]=(257+k,LEXTRA[k],length-lo)
    def dcode(distance):
        for k in range(len(DBASE)-1,-1,-1):
            if distance>=DBASE[k]:return k,DEXTRA[k],distance-DBASE[k]
        raise ValueError('invalid distance')
    # Backward shortest path under the fixed literal/length and distance trees.
    dp=[10**9]*(n+1);choices=[None]*n;dp[n]=ll[256]
    for pos in range(n-1,first-1,-1):
        if ll[src[pos]]:
            best=ll[src[pos]]+dp[pos+1];chosen=('literal',src[pos])
        else:best=10**9;chosen=None
        cheapest={}
        if pos+3<=n:
            for distance in range(1,min(pos,32768)+1):
                if src[pos:pos+3]!=src[pos-distance:pos-distance+3]:continue
                size=3
                while size<min(258,n-pos) and src[pos+size]==src[pos+size-distance]:size+=1
                ds,de,dv=dcode(distance)
                if ds>=len(dd) or not dd[ds]:continue
                for length in range(3,size+1):
                    ls,le,lv=lcode[length]
                    if ls>=len(ll) or not ll[ls]:continue
                    candidate=(dd[ds]+de,distance)
                    if length not in cheapest or candidate<cheapest[length]:cheapest[length]=candidate
        for length,(dc,distance) in cheapest.items():
            ls,le,lv=lcode[length];cost=ll[ls]+le+dc+dp[pos+length];token=('match',length,distance)
            if cost<best or (cost==best and (chosen is None or token<chosen)):
                best,chosen=cost,token
        dp[pos]=best;choices[pos]=chosen
    if dp[first]!=3807:raise ValueError('unexpected fixed-tree payload cost')
    tokens=[];pos=first
    while pos<n:
        token=choices[pos]
        if token is None:raise ValueError('no valid parse')
        tokens.append(token);pos+=1 if token[0]=='literal' else token[1]
    if pos!=n:raise ValueError('invalid parse end')
    out=[]
    def put(width,value):out.extend((value>>i)&1 for i in range(width))
    def code(entry):
        width,value=entry;out.extend((value>>(width-1-i))&1 for i in range(width))
    # First block: fixed Huffman, non-final; 9 literals and end-of-block.
    fixed=table([8]*144+[9]*112+[7]*24+[8]*8)
    put(1,0);put(2,1)
    for byte in src[:first]:code(fixed[byte])
    code(fixed[256])
    if len(out)!=82:raise ValueError('unexpected first block')
    # Final dynamic block, using the pinned code-length alphabet and RLE tokens.
    put(1,1);put(2,2);put(5,len(ll)-257);put(5,len(dd)-1)
    hc=max(4,max(ORDER.index(sym)+1 for sym,width in enumerate(CL) if width))
    put(4,hc-4)
    for sym in ORDER[:hc]:put(3,CL[sym])
    cltable=table(CL)
    for sym,count in RLE:
        code(cltable[sym])
        if sym>=16:
            lo,width={16:(3,2),17:(3,3),18:(11,7)}[sym];put(width,count-lo)
    if len(out)!=82+295:raise ValueError('unexpected dynamic header')
    lt=table(ll);dt=table(dd)
    for token in tokens:
        if token[0]=='literal':code(lt[token[1]])
        else:
            _,length,distance=token;ls,le,lv=lcode[length];code(lt[ls]);put(le,lv)
            ds,de,dv=dcode(distance);code(dt[ds]);put(de,dv)
    code(lt[256])
    if len(out)!=4184:raise ValueError('unexpected stream length')
    raw=bytes(sum(out[j+i]<<i for i in range(8)) for j in range(0,len(out),8))
    gzip=bytes.fromhex('1f8b0800000000000203')+raw+struct.pack('<II',zlib.crc32(src),len(src))
    deflate=b'\x78\xda'+raw+zlib.adler32(src).to_bytes(4,'big')
    result={'raw':raw,'gz':gzip,'deflate':deflate}
    for ext,data in result.items():
        if sha(data)!=EXPECTED[ext]:raise ValueError('output digest mismatch for '+ext)
        decoder=zlib.decompressobj({'raw':-15,'gz':31,'deflate':15}[ext])
        decoded=decoder.decompress(data)+decoder.flush()
        if decoded!=src or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError('incomplete decode for '+ext)
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True,type=Path)
    parser.add_argument('--output-dir',required=True,type=Path)
    args=parser.parse_args();src=args.input.read_bytes();result=run(src)
    # Refuse to reuse the final output path, including a symlink there. An
    # ancestor path component may still resolve through an existing symlink.
    args.output_dir.mkdir(parents=True,exist_ok=False)
    for ext,data in result.items():
        target=args.output_dir/('reproduced.'+ext)
        if target.resolve()==args.input.resolve():raise ValueError('output is input')
        with target.open('xb') as output:
            output.write(data)
    print(json.dumps({'python':platform.python_version(),'zlib':zlib.ZLIB_RUNTIME_VERSION,
                      'sourceSha256':sha(src),'streams':{k:{'bytes':len(v),'sha256':sha(v)} for k,v in result.items()}},indent=2))
if __name__=='__main__':main()
