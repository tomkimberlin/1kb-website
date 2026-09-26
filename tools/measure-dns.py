"""Count A, AAAA and HTTPS DNS exchanges over IPv4/UDP."""
import argparse
import json
from pathlib import Path
from dns_measurement import measure_query, RESOLVER
from probe_response import require_report_outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host')
    parser.add_argument('out', type=Path)
    args = parser.parse_args()
    try:
        require_report_outputs([args.out], [Path(__file__), Path(__file__).with_name('dns_measurement.py'),
                                           Path(__file__).with_name('probe_response.py')])
    except ValueError as error:
        parser.error(str(error))
    reports = [{'type': qtype, **measure_query(args.host, qtype, 0x7210 + qtype)}
               for qtype in (1, 28, 65)]
    args.out.write_text(json.dumps({'host': args.host, 'resolver': RESOLVER[0],
                                  'edns': False, 'dnssec': False, 'queries': reports}, indent=2) + '\n')
    print(reports)


if __name__ == '__main__':
    main()
