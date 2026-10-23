"""Offline classic-BPF interpreter, parser compatibility and startup ordering."""
import ctypes
from pathlib import Path
import socket
import struct
import tempfile
import unittest
from unittest.mock import patch

import test_compare_gallery as fixtures

probe=fixtures.gallery
PEER='198.51.100.9';LOCAL='192.0.2.2';PORT=47300


def interpret(program,frame):
    """Independent interpreter for the small classic-BPF instruction subset."""
    accumulator=index=pc=0
    for _ in range(256):
        if not 0<=pc<len(program):raise AssertionError('Program fell through')
        op,yes,no,value=program[pc]
        if op in (0x20,0x28,0x30,0x48,0xb1):
            position=value+(index if op==0x48 else 0)
            width={0x20:4,0x28:2,0x30:1,0x48:2,0xb1:1}[op]
            if position+width>len(frame):return 0
            loaded=int.from_bytes(frame[position:position+width],'big')
            if op==0xb1:index=(loaded&15)*4
            else:accumulator=loaded
        elif op==0x54:accumulator&=value
        elif op==0x15:pc+=yes if accumulator==value else no
        elif op==0x35:pc+=yes if accumulator>=value else no
        elif op==0x06:return value
        else:raise AssertionError('Unexpected opcode')
        pc+=1
    raise AssertionError('Unbounded program')


def frame(direction='received',ihl=5,payload=0,peer=PEER,local=LOCAL,
          source_port=None,destination_port=None,protocol=6):
    incoming=direction=='received'
    source,destination=(peer,local) if incoming else (local,peer)
    sport=443 if incoming else PORT;dport=PORT if incoming else 443
    if source_port is not None:sport=source_port
    if destination_port is not None:dport=destination_port
    ip=bytearray(ihl*4);ip[0]=0x40|ihl;ip[2:4]=(len(ip)+20+payload).to_bytes(2,'big')
    ip[9]=protocol;ip[12:16]=socket.inet_aton(source);ip[16:20]=socket.inet_aton(destination)
    tcp=bytearray(20);tcp[:4]=struct.pack('!HH',sport,dport);tcp[12]=0x50;tcp[13]=18 if incoming else 2
    return b'\0'*12+b'\x08\x00'+ip+tcp+b'x'*payload


class FilterTests(unittest.TestCase):
    def setUp(self):self.program=probe.kernel_capture_filter(PEER,PORT)

    def test_both_directions_all_legal_ihl_options_and_payload_sizes(self):
        for direction in ['sent','received']:
            for ihl in range(5,16):
                for payload in [0,1,4096]:
                    with self.subTest(direction=direction,ihl=ihl,payload=payload):
                        data=frame(direction,ihl,payload)
                        self.assertGreaterEqual(interpret(self.program,data),len(data))
                        self.assertIsNotNone(probe.tcp_packet(data,PEER,PORT,LOCAL))

    def test_rejects_wrong_peer_ports_protocol_version_and_ethertype(self):
        for direction in ['sent','received']:
            for data in [frame(direction,peer='203.0.113.99'),
                         frame(direction,source_port=123),frame(direction,destination_port=123),
                         frame(direction,protocol=17)]:
                self.assertEqual(interpret(self.program,data),0)
        for offset,value in [(12,b'\x86\xdd'),(12,b'\x81\x00'),(14,b'\x65'),(14,b'\x44')]:
            data=bytearray(frame());data[offset:offset+len(value)]=value
            self.assertEqual(interpret(self.program,data),0)

    def test_all_short_prefixes_reject_before_complete_port_pair(self):
        for direction in ['sent','received']:
            for ihl in [5,6,15]:
                data=frame(direction,ihl);required=14+4*ihl+4
                for cut in range(required):
                    with self.subTest(direction=direction,ihl=ihl,cut=cut):
                        self.assertEqual(interpret(self.program,data[:cut]),0)
                for cut in range(required,len(data)):
                    partial=data[:cut]
                    self.assertGreater(interpret(self.program,partial),0)
                    with self.assertRaises(ValueError):probe.tcp_packet(partial,PEER,PORT,LOCAL)

    def test_malformed_owned_lengths_fragments_and_tcp_offsets_still_reach_python(self):
        cases=[]
        for total in [19,65535]:
            data=bytearray(frame());data[16:18]=total.to_bytes(2,'big');cases.append(data)
        data=bytearray(frame());data[20:22]=b'\x20\0';cases.append(data)
        for offset in [0x40,0xf0]:
            data=bytearray(frame());data[46]=offset;cases.append(data)
        cases.append(frame(payload=1)[:-1])
        for data in cases:
            self.assertGreater(interpret(self.program,data),0)
            with self.assertRaises(ValueError):probe.tcp_packet(data,PEER,PORT,LOCAL)

    def test_python_exact_local_filter_is_still_required_and_unchanged(self):
        for direction in ['sent','received']:
            data=frame(direction,local='192.0.2.88')
            self.assertGreater(interpret(self.program,data),0)
            self.assertIsNone(probe.tcp_packet(data,PEER,PORT,LOCAL))
        # If both IPs equal the peer, either valid direction still satisfies OR.
        self.assertGreater(interpret(self.program,frame('sent',local=PEER)),0)
        self.assertGreater(interpret(self.program,frame('received',local=PEER)),0)

    def test_fixed_port_validation(self):
        for port in [0,-1,65536,True,'47300']:
            with self.assertRaises(ValueError):probe.kernel_capture_filter(PEER,port)
        for port in [1,443,65535]:self.assertTrue(probe.kernel_capture_filter(PEER,port))

    def test_attach_uses_reviewed_linux_sock_fprog_layout_and_reports_failure(self):
        calls=[]
        class Call:
            result=0
            def __call__(self,fd,level,option,program,size):
                record=program._obj
                values=[[x.code,x.jt,x.jf,x.k] for x in record.filter[:record.length]]
                calls.append((fd,level,option,size,values));return self.result
        function=Call()
        class Library:setsockopt=function
        class Raw:
            def fileno(self):return 123
        with patch.object(probe.ctypes,'CDLL',return_value=Library()),patch.object(probe.ctypes,'get_errno',return_value=1):
            probe.attach_capture_filter(Raw(),self.program)
            self.assertEqual(calls[0][:3],(123,1,26));self.assertEqual(calls[0][4],self.program)
            self.assertEqual(calls[0][3],16 if ctypes.sizeof(ctypes.c_void_p)==8 else 8)
            function.result=-1
            with self.assertRaisesRegex(OSError,'kernel filter attach failed'):
                probe.attach_capture_filter(Raw(),self.program)


class StartupTests(unittest.TestCase):
    def run_ordered(self,fail_attach=False):
        self.events=[]
        outer=self
        class TrackingSocket(fixtures.FakeSocket):
            def __init__(self,role):super().__init__();self.role=role
            def bind(self,address):outer.events.append((self.role+'-bind',address))
            def connect(self,address):outer.events.append(('tcp-connect',address))
            def getsockopt(self,*args):return struct.pack('=II',200,0)
        self.raw=TrackingSocket('raw');self.tcp=TrackingSocket('tcp');self.thread=fixtures.FakeThread()
        sockets=[self.raw,self.tcp]
        def factory(*args):
            self.events.append(('socket',args));return sockets.pop(0)
        def attach(raw,program):
            self.assertIn(('tcp-bind',('0.0.0.0',46240)),self.events)
            self.assertFalse(any(event[0]=='raw-bind' for event in self.events))
            self.events.append(('attach',len(program)))
            if fail_attach:raise OSError('fixture attach failure')
        def thread(**kwargs):self.thread=fixtures.FakeThread(**kwargs);return self.thread
        tls=fixtures.FakeTLS(b'<p>fixture','identity')
        with tempfile.TemporaryDirectory() as directory,patch.object(probe.socket,'AF_PACKET',17,create=True),\
             patch.object(probe.socket,'socket',side_effect=factory),\
             patch.object(probe.socket,'gethostbyname',return_value='192.0.2.1'),\
             patch.object(probe,'dns',return_value=[]),patch.object(probe,'attach_capture_filter',side_effect=attach),\
             patch.object(probe.ssl,'create_default_context',return_value=fixtures.FakeContext(tls)),\
             patch.object(probe.threading,'Thread',side_effect=thread),\
             patch.object(probe.select,'select',return_value=([],[],[])),patch.object(probe.time,'sleep'):
            return probe.run('https://example.com/',46240,Path(directory))

    def test_inactive_socket_filter_then_host_order_activation_before_connect(self):
        self.run_ordered()
        self.assertEqual(self.events[0],('socket',(17,socket.SOCK_RAW,0)))
        names=[event[0] for event in self.events]
        self.assertLess(names.index('tcp-bind'),names.index('attach'))
        self.assertLess(names.index('attach'),names.index('raw-bind'))
        self.assertLess(names.index('raw-bind'),names.index('tcp-connect'))
        self.assertIn(('raw-bind',('br0',3)),self.events)
        self.assertTrue(self.raw.closed and self.tcp.closed and self.thread.joined)

    def test_failed_attach_closes_both_sockets_without_activation_connect_or_thread(self):
        with self.assertRaisesRegex(OSError,'fixture attach failure'):self.run_ordered(True)
        names=[event[0] for event in self.events]
        self.assertNotIn('raw-bind',names);self.assertNotIn('tcp-connect',names)
        self.assertFalse(self.thread.started)
        self.assertTrue(self.raw.closed and self.tcp.closed)


if __name__=='__main__':unittest.main()
