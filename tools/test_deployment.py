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
if name=='flock':sys.exit(0)
if name=='date':print('20260926T000000Z');sys.exit(0)
if name=='sha256sum':print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest()+'  -');sys.exit(0)
if name=='mv':
 paths=[x for x in args if not x.startswith('-')];src,dst=map(Path,paths)
 if dst.name=='nginx.conf' and src.name.startswith('nginx.conf.next') and os.environ.get('MOCK_ACTIVATION_FAIL')=='1':sys.exit(1)
 if dst.is_dir() and not dst.is_symlink():dst=dst/src.name
 os.replace(src,dst)
 if dst.name=='certificate-fingerprint' and os.environ.get('MOCK_STAMP_INTERRUPT')=='1' and not (base/'stamp-interrupted').exists():
  (base/'stamp-interrupted').touch();os.kill(os.getppid(),signal.SIGTERM)
 sys.exit(0)
if name=='timeout':
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
 shutil.copyfile(base/'site/current'/('index.html'+suffix),args[args.index('-o')+1])
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
 if '-s reload' in command and os.environ.get('MOCK_RELOAD_FAIL_ALWAYS')=='1':sys.exit(1)
 if '-s reload' in command and os.environ.get('MOCK_RELOAD_FAIL_ONCE')=='1' and not (base/'reload-failed').exists():
  (base/'reload-failed').touch();sys.exit(1)
 if '-t' in args and os.environ.get('MOCK_PREFLIGHT_FAIL')=='1':sys.exit(1)
 sys.exit(0)
if name=='openssl':
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
  for domain in ['tomkimberlin.com','www.tomkimberlin.com','tom.kimberlin.net']:
   # Match ACME's issued-file glob while copied filenames retain the domain.
   (self.base/'acme'/(domain+'-issued.crt')).write_text('VALID:'+domain)
   (self.base/'acme'/(domain+'-issued.key')).write_text('KEY:'+domain)
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
if __name__=='__main__':unittest.main(verbosity=2)
