"""Optional offline gzip optimizer: python -m pip install zopfli==0.4.3."""
from pathlib import Path
import gzip
import zopfli.gzip

source = Path('index.html').read_bytes()
best = None
for iterations in (15, 100, 1000, 10000):
    for splitting in (0, 1):
        data = zopfli.gzip.compress(source, numiterations=iterations, blocksplitting=splitting)
        assert gzip.decompress(data) == source
        if best is None or len(data) < len(best):
            best = data
Path('compression').mkdir(exist_ok=True)
Path('compression/index.html.gz').write_bytes(best)
print(f'{len(source)} bytes HTML -> {len(best)} bytes gzip')
