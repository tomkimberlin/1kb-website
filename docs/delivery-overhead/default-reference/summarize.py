"""Validate and summarize a completed three-round fixture result directory."""
import argparse
import json
from pathlib import Path
import statistics

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('results',type=Path)
a=p.parse_args()
summary={}
for arm,encoding,size in [('stock-identity','identity',1039),('stock-brotli','br',396),('optimized','br',396)]:
    rows=[json.loads((a.results/f'{arm}-{i}.json').read_text()) for i in range(1,4)]
    for row in rows:
        assert row['certificate_verified'] and not row['session_reused']
        assert row['http']=='h2' and row['tls']=='TLSv1.3'
        assert row['body_bytes']==size
        assert row['tls_minus_body']==sum(row['tls_through_body_complete'].values())-size
    values=[row['tls_minus_body'] for row in rows]
    summary[arm]={'median':statistics.median(values),'range':[min(values),max(values)],'samples':values}
assert (a.results/'cleanup.txt').read_text().strip()=='owned containers removed'
assert (a.results/'completed.txt').read_text().strip()=='all nine measured exchanges completed'
assert (a.results/'trust-negative.txt').read_text().strip()=='wrong CA rejected without a result'
print(json.dumps(summary,indent=2))
