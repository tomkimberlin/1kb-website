"""Validate and atomically publish optional compression candidates."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zlib


def require_distinct_paths(source, output):
    if source.resolve() == output.resolve() or (output.exists() and source.samefile(output)):
        raise ValueError(f'Input {source} and --output must refer to different files')


def exact_gzip(data, source):
    # The build reuses one DEFLATE stream after the standard ten-byte header.
    if len(data) < 18 or data[3] != 0:
        return False
    try:
        decoder = zlib.decompressobj(wbits=31)
        decoded = decoder.decompress(data, len(source) + 1)
        return decoder.eof and not decoder.unused_data and decoded == source
    except zlib.error:
        return False


def exact_brotli(data, source):
    # Node supplies an independent decoder; info.bytesWritten detects junk.
    result = subprocess.run(['node', '--input-type=module', '-e', '''
import {readFileSync} from 'node:fs';
import {brotliDecompressSync} from 'node:zlib';
const input=JSON.parse(readFileSync(0,'utf8'));
const source=Buffer.from(input.source,'base64');
const data=Buffer.from(input.data,'base64');
let valid=false;
try {
  const result=brotliDecompressSync(data,{info:true,maxOutputLength:Math.max(1,source.length)});
  valid=result.engine.bytesWritten===data.length&&result.buffer.equals(source);
} catch {}
process.stdout.write(valid?'true':'false');
'''], input=json.dumps({'source': base64.b64encode(source).decode('ascii'),
                       'data': base64.b64encode(data).decode('ascii')}).encode(),
        check=True, stdout=subprocess.PIPE)
    return result.stdout == b'true'


def publish_candidate(source, candidate, output, exact):
    if not exact(candidate, source):
        raise ValueError('Compression round trip failed or has trailing bytes')
    if output.exists():
        existing = output.read_bytes()
        if len(existing) <= len(candidate) and exact(existing, source):
            return existing
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.' + output.name + '.', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(candidate)
            stream.flush()
            os.fchmod(stream.fileno(), 0o644)
        os.replace(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return candidate
