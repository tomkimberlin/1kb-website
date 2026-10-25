"""Response and reporting checks shared by the controlled transport probes."""
import argparse
import ipaddress
from pathlib import Path

COOKIE_HEADERS = frozenset(('cookie', 'set-cookie', 'set-cookie2'))


def require_distinct_report(output, inputs):
    output = Path(output)
    for value in inputs:
        path = Path(value)
        if output.resolve() == path.resolve() or (output.exists() and path.exists() and output.samefile(path)):
            raise ValueError('Report output aliases an input file: ' + str(path))


def require_report_outputs(outputs, inputs):
    """Preflight predictable report files before network requests or writes."""
    previous = []
    for value in outputs:
        output = Path(value)
        if output.is_symlink():
            raise ValueError('Report output must not be a symbolic link: ' + str(output))
        if output.exists() and not output.is_file():
            raise ValueError('Report output must be a regular file: ' + str(output))
        require_distinct_report(output, inputs)
        for other in previous:
            if output.resolve() == other.resolve() or (output.exists() and other.exists() and output.samefile(other)):
                raise ValueError('Report outputs must refer to distinct files')
        previous.append(output)


def ipv4_address(value):
    try:
        return str(ipaddress.IPv4Address(value))
    except ipaddress.AddressValueError as error:
        raise argparse.ArgumentTypeError('Provide a literal IPv4 address; this probe counts IPv4 framing') from error


def validate_brotli_response(headers, body, expected, label):
    statuses = [value for name, value in headers if name.lower() == ':status']
    encodings = [value.strip().lower() for name, value in headers if name.lower() == 'content-encoding']
    if statuses != ['200']:
        raise ValueError(label + ': expected exactly one HTTP 200 status')
    if encodings != ['br']:
        raise ValueError(label + ': expected exactly one Brotli content encoding')
    if body != expected:
        raise ValueError(label + ': response body differs from the local Brotli representation')


def report_headers(headers):
    return [(name, '<redacted>' if name.lower() in COOKIE_HEADERS else value)
            for name, value in headers]


def receive_headers(response, headers):
    # RFC 9114 section 4.1: informational sections precede one final
    # response; trailers cannot replace that response's status or encoding.
    statuses = [value for name, value in headers if name == ':status']
    if not statuses:
        if not response.get('headers'):
            raise ValueError('HTTP/3 trailers arrived before final response headers')
        response.setdefault('trailers', []).extend(headers)
        return
    if (len(statuses) != 1 or len(statuses[0]) != 3 or
            statuses[0][0] not in '12345' or not statuses[0].isascii() or not statuses[0].isdigit()):
        raise ValueError('HTTP/3 response requires exactly one valid status')
    if response.get('headers'):
        raise ValueError('HTTP/3 stream sent headers after its final response')
    if statuses[0].startswith('1'):
        if statuses[0] == '101':
            raise ValueError('HTTP/3 does not support Switching Protocols')
        return
    response['headers'] = headers


def report_qlog(value):
    # aioquic logs headers as nested {name, value} objects. Preserve framing
    # lengths and event metadata while removing cookie values at every depth.
    if isinstance(value, dict):
        cookie = isinstance(value.get('name'), str) and value['name'].lower() in COOKIE_HEADERS
        return {key: '<redacted>' if cookie and key == 'value' else report_qlog(item)
                for key, item in value.items()}
    if isinstance(value, list):
        return [report_qlog(item) for item in value]
    return value
