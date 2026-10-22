"""Isolated shell flow regression fixtures; no SSH, Docker, DNS or real certificates."""
import base64,hashlib,json,os,shutil,subprocess,tempfile,time,unittest
from pathlib import Path
REPO=Path(__file__).resolve().parents[1]
MOCK=r'''#!/usr/bin/env python3
import base64,hashlib,json,os,shutil,signal,subprocess,sys,time
from pathlib import Path
name=Path(sys.argv[0]).name;args=sys.argv[1:];base=Path(os.environ['MOCK_BASE']);log=Path(os.environ['MOCK_LOG']);label=os.environ.get('MOCK_LABEL','')
def event(kind,**data):
 with log.open('a') as out:out.write(json.dumps({'kind':kind,'label':label,**data})+'\n')
def wait(path):
 end=time.monotonic()+8
 while not path.exists():
  if time.monotonic()>end:raise RuntimeError('fixture barrier timed out: '+str(path))
  time.sleep(.01)
def apply_page_generation():
 pending=base/'pending-generation'
 if pending.exists():
  progress=base/'pending-generation-probes';count=int(progress.read_text())+1 if progress.exists() else 1;progress.write_text(str(count))
  reloads=int((base/'reload-count').read_text()) if (base/'reload-count').exists() else 0
  limit=os.environ.get('MOCK_ROLLBACK_APPLY_AFTER_PROBES','1') if reloads>1 else os.environ.get('MOCK_APPLY_AFTER_PROBES','1')
  if count>=int(limit):(base/'active-generation').write_text(pending.read_text());pending.unlink()
if name=='node':
 data=Path('index.html').read_text();Path('public').mkdir(exist_ok=True)
 for suffix in ['', '.br','.gz','.deflate']:Path('public', 'index.html'+suffix).write_text(data+suffix)
 Path('public/representations.json').write_text(json.dumps({encoding:base64.b64encode((data+suffix).encode()).decode() for encoding,suffix in [('identity',''),('br','.br'),('gzip','.gz'),('deflate','.deflate')]}))
 if os.environ.get('MOCK_SAME_CHECKOUT')=='1':
  (base/(label+'-built')).touch()
  if label=='A':wait(base/'B-built')
 if os.environ.get('MOCK_MUTATE_SHARED_PUBLIC'):
  for p in Path(os.environ['MOCK_MUTATE_SHARED_PUBLIC']).iterdir():p.write_text('changed-by-another-build')
 if os.environ.get('MOCK_MUTATE_SHARED_HANDLER'):Path(os.environ['MOCK_MUTATE_SHARED_HANDLER']).write_text('changed-after-build')
 sys.exit(0)
if name=='flock':sys.exit(int(os.environ.get('MOCK_LOCK_EXIT','0')))
if name=='date':print('20260926T000000Z');sys.exit(0)
if name=='sha256sum':print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest()+'  -');sys.exit(0)
if name=='mv':
 paths=[x for x in args if not x.startswith('-')];src,dst=map(Path,paths)
 if dst.name=='nginx.conf' and src.name.startswith('nginx.conf.next') and os.environ.get('MOCK_ACTIVATION_FAIL')=='1':sys.exit(1)
 if dst.name=='certificate-fingerprint' and src.name.startswith('certificate-fingerprint-previous-') and os.environ.get('MOCK_STAMP_RESTORE_FAIL')=='1':
  event('stamp-restore-failed');sys.exit(1)
 if dst==base/'tls/current' and src.name.startswith('rollback-') and os.environ.get('MOCK_TLS_POINTER_RESTORE_FAIL')=='1':
  event('pointer-restore-failed');sys.exit(1)
 if dst.is_dir() and not dst.is_symlink():dst=dst/src.name
 os.replace(src,dst)
 if dst.name=='certificate-fingerprint' and os.environ.get('MOCK_STAMP_INTERRUPT')=='1' and not (base/'stamp-interrupted').exists():
  (base/'stamp-interrupted').touch();os.kill(os.getppid(),signal.SIGTERM)
 sys.exit(0)
if name=='timeout':
 if len(args)>3 and args[3]=='openssl':
  assert args[:3]==['-k','1','4'],'certificate handshakes must have a bounded deadline'
  event('certificate-probe-timeout',seconds=4)
  if os.environ.get('MOCK_CERT_PROBE_INTERRUPT')=='1':os.kill(os.getppid(),signal.SIGTERM);sys.exit(1)
  if os.environ.get('MOCK_CERT_PROBE_TIMEOUT')=='1':sys.exit(124)
  sys.exit(subprocess.run(args[3:]).returncode)
 event('optimizer');sys.exit(127 if os.environ.get('MOCK_OPTIMIZER_FAIL','1')=='1' else 0)
if name=='ssh':
 if args[1]=='sh':
  if os.environ.get('MOCK_RACE')=='1':
   if label=='A':wait(base/'B-uploaded')
   else:wait(base/'A-finished')
  result=subprocess.run(args[1:],input=sys.stdin.buffer.read())
  if label=='A':(base/'A-finished').touch()
 else:result=subprocess.run(['sh','-c',args[1]])
 sys.exit(result.returncode)
if name=='scp':
 if label=='B' and os.environ.get('MOCK_RACE')=='1' and any(Path(x).name=='nginx.conf' for x in args[:-1]):wait(base/'A-uploaded')
 dest=Path(args[-1].split(':',1)[1]);dest.mkdir(parents=True,exist_ok=True) if args[-1].endswith('/') else None
 for source in args[:-1]:
  source=Path(source);target=dest/source.name if dest.is_dir() else dest;shutil.copyfile(source,target)
 if any(Path(x).name=='nginx.conf' for x in args[:-1]):
  event('config-upload',destination=str(dest))
  (base/(label+'-uploaded')).touch()
 sys.exit(0)
if name=='curl':
 if args[0]!='-q' or args[args.index('--noproxy')+1]!='*':raise RuntimeError('health checks must ignore curlrc and proxy settings')
 if os.environ.get('MOCK_INTERRUPT')=='1':os.kill(os.getppid(),signal.SIGTERM);sys.exit(1)
 encoding=args[args.index('-H')+1].split(': ',1)[1];suffix={'br':'.br','gzip':'.gz','deflate':'.deflate','identity':''}[encoding]
 if os.environ.get('MOCK_CURL_FAIL')=='1':sys.exit(22)
 apply_page_generation()
 generation=(base/'active-generation').read_text() if (base/'active-generation').exists() else 'releases/old'
 if (os.environ.get('MOCK_FORWARD_BAD_BODY')=='1' and generation!='releases/old') or (os.environ.get('MOCK_ROLLBACK_BAD_BODY')=='1' and generation=='releases/old'):Path(args[args.index('-o')+1]).write_text('wrong-body')
 else:shutil.copyfile(base/'site'/generation/('index.html'+suffix),args[args.index('-o')+1])
 event('page-body-probe',generation=generation,encoding=encoding)
 status=os.environ.get('MOCK_HTTP_STATUS','200')
 if '-D' in args:
  response_encoding='' if encoding=='identity' or os.environ.get('MOCK_BAD_ENCODING')=='1' else 'Content-Encoding:'+encoding+'\r\n'
  if encoding=='identity' and os.environ.get('MOCK_EMPTY_IDENTITY'):
   response_encoding='Content-Encoding:\r\n'*(2 if os.environ['MOCK_EMPTY_IDENTITY']=='duplicate' else 1)
  Path(args[args.index('-D')+1]).write_text('HTTP/2 '+status+'\r\n'+response_encoding+'\r\n')
 if '-w' in args:print(status,end='')
 sys.exit(0)
if name=='sleep':sys.exit(0)
if name=='docker':
 command=' '.join(args);event('docker',command=command,current=os.readlink(base/'site/current') if (base/'site/current').is_symlink() else '',config=(base/'nginx/nginx.conf').read_text() if (base/'nginx/nginx.conf').exists() else '',tls_current=os.readlink(base/'tls/current') if (base/'tls/current').is_symlink() else '')
 if 'curl' in args:
  if '--noproxy' not in args or args[args.index('--noproxy')+1]!='*' or '-q' not in args:raise RuntimeError('readiness must ignore curlrc and proxies')
  if args[args.index('--connect-to')+1]!='tomkimberlin.com:443:127.0.0.1:9443' or args[-1]!='https://tomkimberlin.com/.well-known/onekb-release' or any(x in args for x in ['-k','--insecure']):raise RuntimeError('readiness must verify the existing private TLS listener with the public hostname')
  probes=base/'readiness-probes';count=int(probes.read_text())+1 if probes.exists() else 1;probes.write_text(str(count))
  apply_page_generation()
  active=base/'active-generation'
  if os.environ.get('MOCK_READINESS_HTTP_FAIL')=='1':sys.exit(22)
  value=active.read_text() if active.exists() else 'releases/old'
  print(os.environ.get('MOCK_READINESS_BODY','/srv/'+value+'/'),end='')
  if '-w' in args:print('\n'+os.environ.get('MOCK_READINESS_STATUS','200'),end='')
  sys.exit(0)
 if '-s reload' in command:
  counter=base/'reload-count';number=int(counter.read_text())+1 if counter.exists() else 1;counter.write_text(str(number))
  if number>1 and os.environ.get('MOCK_IGNORE_ROLLBACK_RELOAD')=='1':event('ignored-rollback-reload');sys.exit(0)
 if '-s reload' in command and os.environ.get('MOCK_RELOAD_FAIL_ALWAYS')=='1':sys.exit(1)
 if '-s reload' in command and os.environ.get('MOCK_RELOAD_FAIL_ONCE')=='1' and not (base/'reload-failed').exists():
  (base/'reload-failed').touch();sys.exit(1)
 if '-t' in args and os.environ.get('MOCK_PREFLIGHT_FAIL')=='1':sys.exit(1)
 if '-s reload' in command and os.environ.get('MOCK_RELOAD_NOT_APPLIED')!='1':
  (base/'pending-generation').write_text(os.readlink(base/'site/current'))
  (base/'pending-generation-probes').unlink(missing_ok=True)
 if '-s reload' in command and os.environ.get('MOCK_CERT_RELOAD_NOT_APPLIED')!='1':
  target=os.readlink(base/'tls/current') if (base/'tls/current').is_symlink() else ''
  delayed=os.environ.get('MOCK_CERT_ROLLBACK_APPLY_AFTER_PROBES') if int((base/'reload-count').read_text())>1 else os.environ.get('MOCK_CERT_APPLY_AFTER_PROBES')
  marker='pending-tls-release' if delayed else 'served-tls-release'
  (base/'state/pending-tls-probes').unlink(missing_ok=True)
  (base/'state'/marker).write_text(target)
 sys.exit(0)
if name=='openssl':
 if args[0]=='crl2pkcs7':
  text=Path(args[args.index('-certfile')+1]).read_text()
  if text.startswith('VALID:'):canonical=text.encode()
  else:
   import re
   blocks=re.findall(r'-----BEGIN CERTIFICATE-----\n(.*?)\n-----END CERTIFICATE-----',text,re.S)
   if not blocks:sys.exit(1)
   try:canonical=b''.join(base64.b64decode(''.join(block.split()),validate=True) for block in blocks)
   except ValueError:sys.exit(1)
  assert args[args.index('-outform')+1]=='DER'
  Path(args[args.index('-out')+1]).write_bytes(canonical);sys.exit(0)
 if args[0]=='s_client':
  domain=args[args.index('-servername')+1]
  assert args[args.index('-verify_hostname')+1]==domain
  assert '-verify_return_error' in args and '-showcerts' in args
  assert args[args.index('-connect')+1]=='192.168.0.2:8443'
  assert args[args.index('-CAfile')+1]=='/etc/ssl/certs/ca-certificates.crt'
  event('certificate-probe',domain=domain)
  if os.environ.get('MOCK_CERT_PROBE_FAIL')=='1' or os.environ.get('MOCK_CERT_PROBE_FAIL_DOMAIN')==domain:sys.exit(1)
  counter=base/'state/tls-probe-count';count=int(counter.read_text())+1 if counter.exists() else 1;counter.write_text(str(count))
  pending=base/'state/pending-tls-release'
  if pending.exists():
   progress=base/'state/pending-tls-probes';pending_count=int(progress.read_text())+1 if progress.exists() else 1;progress.write_text(str(pending_count))
   limit=os.environ.get('MOCK_CERT_ROLLBACK_APPLY_AFTER_PROBES','0') if int((base/'reload-count').read_text())>1 else os.environ.get('MOCK_CERT_APPLY_AFTER_PROBES','0')
   if pending_count>=int(limit):(base/'state/served-tls-release').write_text(pending.read_text());pending.unlink()
  target=(base/'state/served-tls-release').read_text()
  data=(base/'tls'/target/(domain+'.crt')).read_bytes()
  print('Session diagnostics that must not be compared or retained.')
  if os.environ.get('MOCK_CERT_PEER_EMPTY')=='1':sys.exit(0)
  print('-----BEGIN CERTIFICATE-----')
  print(base64.b64encode(data).decode())
  if os.environ.get('MOCK_CERT_PEER_MALFORMED')!='1':print('-----END CERTIFICATE-----')
  print('Session diagnostics after the public certificate.')
  sys.exit(0)
 if args[0]=='verify':sys.exit(0 if Path(args[-1]).read_text().startswith('VALID:') else 1)
 if args[0]=='x509':
  cert=Path(args[args.index('-in')+1]);data=cert.read_text();domain=cert.name[:-4]
  if '-pubkey' in args:
   print('PUBLIC:'+domain);sys.exit(0)
  event('certificate-check',path=str(cert),data=data)
  sys.exit(0 if data.startswith('VALID:') else 1)
 if args[0]=='pkey':
  if '-pubin' in args:
   data=Path(args[args.index('-in')+1]).read_bytes() if '-in' in args else sys.stdin.buffer.read();sys.stdout.buffer.write(data);sys.exit(0)
  key=Path(args[args.index('-in')+1]);domain=key.name[:-4];print('PUBLIC:'+domain)
  if os.environ.get('MOCK_CERT_RACE')=='1':
   domain=domain.removesuffix('-issued');(base/'acme'/(domain+'-issued.crt')).write_text('UNVALIDATED:changed-during-renewal');event('acme-mutation')
  if os.environ.get('MOCK_KEY_MISMATCH')=='1':print('MISMATCH')
  sys.exit(0)
raise RuntimeError('unexpected mock command '+name+repr(args))
'''
class DeploymentTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='onekb-deploy-tests-');self.root=Path(self.tmp.name);self.base=self.root/'remote';self.bin=self.root/'bin';self.bin.mkdir();self.log=self.root/'events.jsonl';self.log.touch()
  for name in ['node','flock','date','sha256sum','mv','timeout','ssh','scp','curl','sleep','docker','openssl']:
   p=self.bin/name;p.write_text(MOCK);p.chmod(0o755)
  self.env=dict(os.environ,PATH=str(self.bin)+os.pathsep+os.environ['PATH'],MOCK_BASE=str(self.base),MOCK_LOG=str(self.log))
  for directory in ['site/releases/old','nginx','backups','state','acme','tls/releases/old','bin']:(self.base/directory).mkdir(parents=True,exist_ok=True)
  (self.base/'site/current').symlink_to('releases/old');(self.base/'tls/current').symlink_to('releases/old');(self.base/'nginx/nginx.conf').write_text('OLD-CONFIG')
  (self.base/'state/served-tls-release').write_text('releases/old')
  for suffix in ['', '.br','.gz','.deflate']:(self.base/'site/releases/old'/('index.html'+suffix)).write_text('OLD'+suffix)
  for domain in ['tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net']:
   # Match ACME's issued-file glob while copied filenames retain the domain.
   (self.base/'acme'/(domain+'-issued.crt')).write_text('VALID:'+domain)
   (self.base/'acme'/(domain+'-issued.key')).write_text('KEY:'+domain)
   (self.base/'tls/releases/old'/(domain+'.crt')).write_text('VALID:OLD:'+domain)
 def tearDown(self):self.tmp.cleanup()
 def script(self,name,label='A',body=None):
  client=self.root/label;(client/'server').mkdir(parents=True,exist_ok=True);(client/'public').mkdir(exist_ok=True)
  source=(REPO/'server'/name).read_text().replace('/mnt/user/appdata/onekb-website',str(self.base))
  script=client/'server'/name;script.write_text(source)
  (client/'index.html').write_text(body or label)
  (client/'build.mjs').write_text('// mocked build')
  for suffix in ['', '.br','.gz','.deflate']:(client/'public'/('index.html'+suffix)).write_text((body or label)+suffix)
  (client/'server/site.js').write_text('HANDLER:'+label)
  (client/'server/nginx.conf').write_text('js_import site from /srv/current/site.js;\njs_preload_object onekbRepresentations from /srv/current/representations.json;\nMARKER:'+label)
  return script
 def run_script(self,name,extra=None,label='A',body=None):
  script=self.script(name,label,body);env=dict(self.env,MOCK_LABEL=label,**(extra or {}));return subprocess.run(['sh',str(script),*(['fixture-host'] if name=='deploy.sh' else [])],env=env,capture_output=True,text=True,timeout=12)
 def events(self):return [json.loads(x) for x in self.log.read_text().splitlines()]
 def test_parallel_deploys_keep_their_own_configuration(self):
  processes=[]
  for label in ['A','B']:
   script=self.script('deploy.sh',label);processes.append(subprocess.Popen(['sh',str(script),'fixture-host'],env=dict(self.env,MOCK_LABEL=label,MOCK_RACE='1'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
  for process in processes:
   out,err=process.communicate(timeout=12);self.assertEqual(process.returncode,0,out+err)
  reloads=[x for x in self.events() if x['kind']=='docker' and '-s reload' in x['command']]
  self.assertEqual([x['label'] for x in reloads],['A','B'])
  for event in reloads:
   self.assertIn('MARKER:'+event['label'],event['config'])
   self.assertNotIn('/srv/current/',event['config'])
   self.assertIn('/srv/'+event['current']+'/site.js',event['config'])
   self.assertIn('/srv/'+event['current']+'/representations.json',event['config'])
 def test_same_second_same_html_gets_distinct_releases(self):
  releases=[]
  for label in ['A','B']:
   result=self.run_script('deploy.sh',label=label,body='unchanged');self.assertEqual(result.returncode,0,result.stdout+result.stderr);releases.append(os.readlink(self.base/'site/current'))
  self.assertNotEqual(*releases)
  self.assertEqual((self.base/'site'/releases[0]/'site.js').read_text(),'HANDLER:A')
 def test_certificate_publication_uses_validated_snapshot(self):
  result=self.run_script('publish-certificates.sh',{'ONEKB_PREPARE_ONLY':'1','MOCK_CERT_RACE':'1'})
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  for domain in ['tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net']:
   self.assertEqual((self.base/'tls/current'/(domain+'.crt')).read_text(),'VALID:'+domain)
  self.assertFalse(list((self.base/'tls/releases').glob('.pending.*')))
 def test_deploy_failed_reload_restores_configuration_and_release(self):
  result=self.run_script('deploy.sh',{'MOCK_RELOAD_FAIL_ONCE':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
  self.assertEqual((self.base/'nginx/nginx.conf').read_text(),'OLD-CONFIG')
 def test_certificate_mismatch_does_not_activate(self):
  result=self.run_script('publish-certificates.sh',{'ONEKB_PREPARE_ONLY':'1','MOCK_KEY_MISMATCH':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
  self.assertFalse(list((self.base/'tls/releases').glob('.pending.*')))
 def test_deploy_failed_preflight_does_not_activate(self):
  result=self.run_script('deploy.sh',{'MOCK_PREFLIGHT_FAIL':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
  self.assertEqual((self.base/'nginx/nginx.conf').read_text(),'OLD-CONFIG')
 def test_deploy_failed_config_rename_rolls_back(self):
  result=self.run_script('deploy.sh',{'MOCK_ACTIVATION_FAIL':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
  self.assertEqual((self.base/'nginx/nginx.conf').read_text(),'OLD-CONFIG')
 def test_deploy_failed_health_check_rolls_back(self):
  result=self.run_script('deploy.sh',{'MOCK_CURL_FAIL':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
  self.assertEqual((self.base/'nginx/nginx.conf').read_text(),'OLD-CONFIG')
 def test_reload_signal_without_new_generation_cannot_commit_matching_bodies(self):
  for suffix in ['', '.br','.gz','.deflate']:(self.base/'site/releases/old'/('index.html'+suffix)).write_text('unchanged'+suffix)
  result=self.run_script('deploy.sh',{'MOCK_RELOAD_NOT_APPLIED':'1'},body='unchanged')
  self.assertNotEqual(result.returncode,0)
  self.assertIn('readiness',result.stderr)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
  self.assertEqual((self.base/'nginx/nginx.conf').read_text(),'OLD-CONFIG')
 def test_readiness_waits_for_delayed_new_generation(self):
  result=self.run_script('deploy.sh',{'MOCK_APPLY_AFTER_PROBES':'3'})
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertEqual((self.base/'readiness-probes').read_text(),'3')
 def test_wrong_empty_or_failed_readiness_rolls_back(self):
  for extra in [{'MOCK_READINESS_BODY':'/srv/releases/wrong/'},{'MOCK_READINESS_BODY':''},{'MOCK_READINESS_HTTP_FAIL':'1'},{'MOCK_READINESS_STATUS':'301'}]:
   with self.subTest(extra=extra):
    result=self.run_script('deploy.sh',extra)
    self.assertNotEqual(result.returncode,0)
    self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
    self.assertEqual((self.base/'nginx/nginx.conf').read_text(),'OLD-CONFIG')
 def test_interrupted_deploy_rolls_back(self):
  result=self.run_script('deploy.sh',{'MOCK_INTERRUPT':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
  self.assertEqual((self.base/'nginx/nginx.conf').read_text(),'OLD-CONFIG')
 def test_certificate_unchanged_skips_optimizer_and_reload(self):
  for attempt in range(2):
   result=self.run_script('publish-certificates.sh')
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)
   if attempt==0:
    first=os.readlink(self.base/'tls/current');events=len(self.events())
  self.assertEqual(os.readlink(self.base/'tls/current'),first)
  later=self.events()[events:]
  self.assertFalse(any(x['kind'] in ['optimizer','docker'] for x in later))
  self.assertFalse(list((self.base/'tls/releases').glob('.pending.*')))
  data=b''.join((self.base/'tls/current'/(domain+'.crt')).read_bytes() for domain in ['tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net'])
  self.assertEqual((self.base/'state/certificate-fingerprint').read_text().strip(),hashlib.sha256(data).hexdigest())
 def test_certificate_failed_preflight_restores_previous(self):
  result=self.run_script('publish-certificates.sh',{'MOCK_PREFLIGHT_FAIL':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
 def test_certificate_failed_reload_restores_and_reloads_previous(self):
  result=self.run_script('publish-certificates.sh',{'MOCK_RELOAD_FAIL_ONCE':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
  reloads=[x for x in self.events() if x['kind']=='docker' and '-s reload' in x['command']]
  self.assertEqual(len(reloads),2)
  self.assertEqual(reloads[-1]['tls_current'],'releases/old')
 def test_failed_initial_certificate_activation_removes_pointer(self):
  (self.base/'tls/current').unlink()
  result=self.run_script('publish-certificates.sh',{'MOCK_PREFLIGHT_FAIL':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertFalse((self.base/'tls/current').is_symlink())
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
 def test_deploy_wrong_encoding_rolls_back(self):
  result=self.run_script('deploy.sh',{'MOCK_BAD_ENCODING':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
 def test_deploy_non200_matching_body_rolls_back(self):
  result=self.run_script('deploy.sh',{'MOCK_HTTP_STATUS':'301'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
 def test_interruption_after_fingerprint_write_restores_previous_state(self):
  (self.base/'state/certificate-fingerprint').write_text('previous-fingerprint\n')
  result=self.run_script('publish-certificates.sh',{'MOCK_STAMP_INTERRUPT':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertEqual((self.base/'state/certificate-fingerprint').read_text(),'previous-fingerprint\n')
  result=self.run_script('publish-certificates.sh')
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertNotEqual(os.readlink(self.base/'tls/current'),'releases/old')
 def test_private_build_survives_shared_checkout_changes(self):
  result=self.run_script('deploy.sh',{'MOCK_MUTATE_SHARED_PUBLIC':str(self.root/'A/public'),'MOCK_MUTATE_SHARED_HANDLER':str(self.root/'A/server/site.js')},body='frozen-input')
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  for suffix in ['', '.br','.gz','.deflate']:
   self.assertEqual((self.base/'site/current'/('index.html'+suffix)).read_text(),'frozen-input'+suffix)
  snapshot=json.loads((self.base/'site/current/representations.json').read_text())
  for encoding,suffix in [('identity',''),('br','.br'),('gzip','.gz'),('deflate','.deflate')]:
   self.assertEqual(base64.b64decode(snapshot[encoding]),('frozen-input'+suffix).encode())
  self.assertEqual((self.base/'site/current/site.js').read_text(),'HANDLER:A')
 def test_parallel_builds_from_same_checkout_keep_matching_representations(self):
  script=self.script('deploy.sh','A',body='A')
  first=subprocess.Popen(['sh',str(script),'fixture-host'],env=dict(self.env,MOCK_LABEL='A',MOCK_RACE='1',MOCK_SAME_CHECKOUT='1'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  processes=[first]
  try:
   deadline=time.monotonic()+8
   while not (self.base/'A-built').exists():
    self.assertLess(time.monotonic(),deadline,'first build did not reach fixture barrier')
    time.sleep(.01)
   self.script('deploy.sh','A',body='B')
   (script.parent/'site.js').write_text('HANDLER:B')
   (script.parent/'nginx.conf').write_text('js_import site from /srv/current/site.js;\njs_preload_object onekbRepresentations from /srv/current/representations.json;\nMARKER:B')
   processes.append(subprocess.Popen(['sh',str(script),'fixture-host'],env=dict(self.env,MOCK_LABEL='B',MOCK_RACE='1',MOCK_SAME_CHECKOUT='1'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
   for process in processes:
    out,err=process.communicate(timeout=12);self.assertEqual(process.returncode,0,out+err)
   reloads=[x for x in self.events() if x['kind']=='docker' and '-s reload' in x['command']]
   self.assertEqual([x['label'] for x in reloads],['A','B'])
   for event in reloads:
    release=self.base/'site'/event['current'];label=event['label']
    for suffix in ['', '.br','.gz','.deflate']:
     self.assertEqual((release/('index.html'+suffix)).read_text(),label+suffix)
    snapshot=json.loads((release/'representations.json').read_text())
    for encoding,suffix in [('identity',''),('br','.br'),('gzip','.gz'),('deflate','.deflate')]:
     self.assertEqual(base64.b64decode(snapshot[encoding]),(label+suffix).encode())
    self.assertEqual((release/'site.js').read_text(),'HANDLER:'+label)
    self.assertIn('MARKER:'+label,event['config'])
  finally:
   for process in processes:
    if process.poll() is None:process.kill();process.communicate()
 def test_identity_rejects_empty_encoding_headers(self):
  for kind in ['single','duplicate']:
   with self.subTest(kind=kind):
    result=self.run_script('deploy.sh',{'MOCK_EMPTY_IDENTITY':kind})
    self.assertNotEqual(result.returncode,0)
    self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
 def test_stamp_interruption_restores_absent_state(self):
  for prior_link in [True,False]:
   with self.subTest(prior_link=prior_link):
    marker=self.base/'stamp-interrupted'
    if marker.exists():marker.unlink()
    if not prior_link:(self.base/'tls/current').unlink()
    result=self.run_script('publish-certificates.sh',{'ONEKB_PREPARE_ONLY':'1','MOCK_STAMP_INTERRUPT':'1'})
    self.assertNotEqual(result.returncode,0)
    self.assertFalse((self.base/'state/certificate-fingerprint').exists())
    if prior_link:self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
    else:self.assertFalse((self.base/'tls/current').is_symlink())
 def test_failed_certificate_rollback_reload_still_restores_state(self):
  (self.base/'state/certificate-fingerprint').write_text('previous-fingerprint\n')
  result=self.run_script('publish-certificates.sh',{'MOCK_RELOAD_FAIL_ALWAYS':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertIn('Certificate rollback failed',result.stderr)
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertEqual((self.base/'state/certificate-fingerprint').read_text(),'previous-fingerprint\n')
 def test_failed_deploy_rollback_reload_preserves_previous_files(self):
  result=self.run_script('deploy.sh',{'MOCK_RELOAD_FAIL_ALWAYS':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertIn('Deployment rollback failed',result.stderr)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
  self.assertEqual((self.base/'nginx/nginx.conf').read_text(),'OLD-CONFIG')
 def assert_certificate_probe_cleanup(self):
  self.assertFalse(list((self.base/'state').glob('.certificate-check.*')))
 def test_certificate_unapplied_reload_restores_state_and_allows_retry(self):
  result=self.run_script('publish-certificates.sh',{'MOCK_CERT_RELOAD_NOT_APPLIED':'1'})
  self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
  self.assert_certificate_probe_cleanup()
  result=self.run_script('publish-certificates.sh')
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertNotEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assert_certificate_probe_cleanup()
 def test_certificate_same_leaf_changed_chain_requires_actual_application(self):
  for domain in ['tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net']:
   (self.base/'acme'/(domain+'-issued.crt')).write_text('VALID:LEAF:'+domain+'\nCHAIN:new')
   (self.base/'tls/releases/old'/(domain+'.crt')).write_text('VALID:LEAF:'+domain+'\nCHAIN:old')
  result=self.run_script('publish-certificates.sh',{'MOCK_CERT_RELOAD_NOT_APPLIED':'1'})
  self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assert_certificate_probe_cleanup()
 def test_certificate_checks_every_sni_hostname(self):
  result=self.run_script('publish-certificates.sh',{'MOCK_CERT_PROBE_FAIL_DOMAIN':'www.tomkimberlin.com'})
  self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
  domains=[x['domain'] for x in self.events() if x['kind']=='certificate-probe']
  self.assertEqual(domains,['tomkimberlin.com','www.tomkimberlin.com']*6)
  self.assertIn('Certificate rollback failed',result.stderr)
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
  self.assert_certificate_probe_cleanup()
 def test_certificate_delayed_reload_retries_until_all_chains_match(self):
  result=self.run_script('publish-certificates.sh',{'MOCK_CERT_APPLY_AFTER_PROBES':'2'})
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  domains=[x['domain'] for x in self.events() if x['kind']=='certificate-probe']
  self.assertEqual(domains,['tomkimberlin.com','tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net'])
  self.assert_certificate_probe_cleanup()
 def test_certificate_empty_or_malformed_peer_chain_rolls_back(self):
  for flag in ['MOCK_CERT_PEER_EMPTY','MOCK_CERT_PEER_MALFORMED']:
   with self.subTest(flag=flag):
    result=self.run_script('publish-certificates.sh',{flag:'1'})
    self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
    self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
    self.assertFalse((self.base/'state/certificate-fingerprint').exists())
    self.assert_certificate_probe_cleanup()
 def test_certificate_handshake_deadline_is_bounded(self):
  result=self.run_script('publish-certificates.sh',{'MOCK_CERT_PROBE_TIMEOUT':'1'})
  self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertEqual(len([x for x in self.events() if x['kind']=='certificate-probe-timeout']),6)
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
  self.assert_certificate_probe_cleanup()
 def test_certificate_probe_interruption_restores_state_and_cleans_capture(self):
  (self.base/'state/certificate-fingerprint').write_text('previous-fingerprint\n')
  result=self.run_script('publish-certificates.sh',{'MOCK_CERT_PROBE_INTERRUPT':'1'})
  self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertEqual((self.base/'state/certificate-fingerprint').read_text(),'previous-fingerprint\n')
  self.assert_certificate_probe_cleanup()
 def test_unchanged_fingerprint_with_wrong_served_chain_recovers(self):
  data=b''.join((self.base/'acme'/(domain+'-issued.crt')).read_bytes() for domain in ['tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net'])
  (self.base/'state/certificate-fingerprint').write_text(hashlib.sha256(data).hexdigest()+'\n')
  result=self.run_script('publish-certificates.sh')
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  reloads=[x for x in self.events() if x['kind']=='docker' and '-s reload' in x['command']]
  self.assertEqual(len(reloads),1)
  self.assertNotEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assert_certificate_probe_cleanup()
 def test_prepare_only_does_not_probe_a_service(self):
  result=self.run_script('publish-certificates.sh',{'ONEKB_PREPARE_ONLY':'1'})
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertFalse(any(x['kind']=='certificate-probe-timeout' for x in self.events()))
  self.assert_certificate_probe_cleanup()

 def marked_previous_page(self):
  (self.base/'nginx/nginx.conf').write_text('OLD-CONFIG\nlocation = /.well-known/onekb-release { return 200 "/srv/releases/old/"; }\n')
 def test_unapplied_page_rollback_reports_actual_generation_failure(self):
  self.marked_previous_page()
  result=self.run_script('deploy.sh',{'MOCK_FORWARD_BAD_BODY':'1','MOCK_IGNORE_ROLLBACK_RELOAD':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertIn('Deployment rollback failed',result.stderr)
  self.assertEqual(os.readlink(self.base/'site/current'),'releases/old')
  self.assertNotEqual((self.base/'active-generation').read_text(),'releases/old')
 def test_delayed_page_rollback_verifies_old_generation_and_four_bodies(self):
  self.marked_previous_page()
  result=self.run_script('deploy.sh',{'MOCK_FORWARD_BAD_BODY':'1','MOCK_ROLLBACK_APPLY_AFTER_PROBES':'3'})
  self.assertNotEqual(result.returncode,0)
  self.assertNotIn('Deployment rollback failed',result.stderr)
  self.assertEqual((self.base/'active-generation').read_text(),'releases/old')
  old_probes=[x['encoding'] for x in self.events() if x['kind']=='page-body-probe' and x['generation']=='releases/old']
  self.assertEqual(old_probes,['br','gzip','deflate','identity'])
  self.assertEqual((self.base/'pending-generation-probes').read_text(),'3')
 def test_legacy_page_rollback_distinguishes_restored_bodies_from_unknown_generation(self):
  result=self.run_script('deploy.sh',{'MOCK_FORWARD_BAD_BODY':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertIn('Previous configuration and page bodies were restored',result.stderr)
  self.assertIn('worker generation cannot be verified',result.stderr)
  self.assertIn('Deployment rollback failed',result.stderr)
  old_probes=[x['encoding'] for x in self.events() if x['kind']=='page-body-probe' and x['generation']=='releases/old']
  self.assertEqual(old_probes,['br','gzip','deflate','identity'])
 def test_unapplied_certificate_rollback_reports_actual_chain_failure(self):
  result=self.run_script('publish-certificates.sh',{'MOCK_STAMP_INTERRUPT':'1','MOCK_IGNORE_ROLLBACK_RELOAD':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertIn('Certificate rollback failed',result.stderr)
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertNotEqual((self.base/'state/served-tls-release').read_text(),'releases/old')
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
  self.assert_certificate_probe_cleanup()
 def test_delayed_certificate_rollback_verifies_all_previous_chains(self):
  result=self.run_script('publish-certificates.sh',{'MOCK_STAMP_INTERRUPT':'1','MOCK_CERT_ROLLBACK_APPLY_AFTER_PROBES':'2'})
  self.assertNotEqual(result.returncode,0)
  self.assertNotIn('Certificate rollback failed',result.stderr)
  self.assertEqual((self.base/'state/served-tls-release').read_text(),'releases/old')
  self.assertEqual((self.base/'state/pending-tls-probes').read_text(),'2')
  domains=[x['domain'] for x in self.events() if x['kind']=='certificate-probe']
  self.assertEqual(domains[-4:],['tomkimberlin.com','tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net'])
  self.assert_certificate_probe_cleanup()
 def test_prepare_only_interruption_does_not_probe_during_rollback(self):
  result=self.run_script('publish-certificates.sh',{'ONEKB_PREPARE_ONLY':'1','MOCK_STAMP_INTERRUPT':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertFalse(any(x['kind']=='certificate-probe' for x in self.events()))
  self.assertNotIn('Certificate rollback failed',result.stderr)
  self.assert_certificate_probe_cleanup()
 def test_old_marker_alone_does_not_accept_wrong_rollback_representations(self):
  self.marked_previous_page()
  for fault in [{'MOCK_ROLLBACK_BAD_BODY':'1'},{'MOCK_BAD_ENCODING':'1'}]:
   with self.subTest(fault=fault):
    result=self.run_script('deploy.sh',dict(MOCK_FORWARD_BAD_BODY='1',**fault))
    self.assertNotEqual(result.returncode,0)
    self.assertIn('Deployment rollback failed',result.stderr)
    self.assertEqual((self.base/'active-generation').read_text(),'releases/old')
 def test_missing_previous_certificate_release_reports_unverifiable_recovery(self):
  (self.base/'tls/current').unlink()
  result=self.run_script('publish-certificates.sh',{'MOCK_RELOAD_FAIL_ONCE':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertIn('No previous certificate release exists; live recovery cannot be verified',result.stderr)
  self.assertIn('Certificate rollback failed',result.stderr)
  self.assertFalse((self.base/'tls/current').is_symlink())
  self.assertFalse((self.base/'state/certificate-fingerprint').exists())
  self.assert_certificate_probe_cleanup()
 def test_publication_lock_contention_is_benign_but_operation_errors_fail(self):
  for code in ['1','69']:
   with self.subTest(code=code):
    result=self.run_script('publish-certificates.sh',{'MOCK_LOCK_EXIT':code})
    self.assertEqual(result.returncode,0 if code=='1' else 69,result.stdout+result.stderr)
    self.assertEqual('lock failed' in result.stderr,code!='1')
    self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
    self.assert_certificate_probe_cleanup()
 def test_optimizer_lock_contention_is_benign_but_operation_errors_fail(self):
  for code in ['1','69']:
   with self.subTest(code=code):
    result=self.run_script('cache-certificates.sh',{'MOCK_LOCK_EXIT':code})
    self.assertEqual(result.returncode,0 if code=='1' else 69,result.stdout+result.stderr)
    self.assertEqual('lock failed' in result.stderr,code!='1')

 def test_stamp_restore_failure_still_reloads_and_verifies_a_safe_previous_pointer(self):
  (self.base/'state/certificate-fingerprint').write_text('previous-fingerprint\n')
  result=self.run_script('publish-certificates.sh',{'MOCK_STAMP_INTERRUPT':'1','MOCK_STAMP_RESTORE_FAIL':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertIn('Certificate rollback failed',result.stderr)
  self.assertEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertEqual((self.base/'state/served-tls-release').read_text(),'releases/old')
  self.assertNotEqual((self.base/'state/certificate-fingerprint').read_text(),'previous-fingerprint\n')
  events=self.events();self.assertEqual(len([x for x in events if x['kind']=='stamp-restore-failed']),1)
  reloads=[i for i,x in enumerate(events) if x['kind']=='docker' and '-s reload' in x['command']]
  self.assertEqual(len(reloads),2)
  domains=[x['domain'] for x in events[reloads[-1]+1:] if x['kind']=='certificate-probe']
  self.assertEqual(domains,['tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net'])
  self.assert_certificate_probe_cleanup()
 def test_failed_pointer_restore_never_reloads_even_when_stamp_restore_succeeds(self):
  (self.base/'state/certificate-fingerprint').write_text('previous-fingerprint\n')
  result=self.run_script('publish-certificates.sh',{'MOCK_STAMP_INTERRUPT':'1','MOCK_TLS_POINTER_RESTORE_FAIL':'1'})
  self.assertNotEqual(result.returncode,0)
  self.assertIn('Certificate rollback failed',result.stderr)
  self.assertNotEqual(os.readlink(self.base/'tls/current'),'releases/old')
  self.assertNotEqual((self.base/'state/served-tls-release').read_text(),'releases/old')
  self.assertEqual((self.base/'state/certificate-fingerprint').read_text(),'previous-fingerprint\n')
  events=self.events();self.assertEqual(len([x for x in events if x['kind']=='pointer-restore-failed']),1)
  self.assertEqual(len([x for x in events if x['kind']=='docker' and '-s reload' in x['command']]),1)
  self.assertEqual(len([x for x in events if x['kind']=='certificate-probe']),3)
  self.assert_certificate_probe_cleanup()
if __name__=='__main__':unittest.main(verbosity=2)
