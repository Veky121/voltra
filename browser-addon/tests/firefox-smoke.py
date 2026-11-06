"""Native Firefox test against a loopback API fixture, never a real game server.
Usage: python firefox-smoke.py FIREFOX_EXE GECKODRIVER_EXE
Build dist-firefox first. Uses an isolated temporary profile and unsigned test install.
"""
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import urllib.error
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
ADDON_ID = 'voltra-companion@njimgang.org'
UUID = '3edc88c6-dc27-4fb7-9a84-d6e8bb6ca83a'
KEY = 'ptlc_native-firefox-fixture-only'
posts = []

class API(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        assert self.headers.get('Cookie') is None
        if self.headers.get('Authorization') != 'Bearer ' + KEY:
            self.send_response(401)
            self.end_headers()
            return
        server = {'uuid':'server-1','name':'Firefox fixture','egg_features':['voltra_fs25'],'status':None}
        if self.path.startswith('/api/client?'):
            result = {'data':[{'attributes':server}]}
        elif '/files/list' in self.path:
            result = {'data':[]}
        elif '/files/pulls' in self.path:
            result = {'transfers':[{'identifier':'native-job','state':'complete'}]}
        else:
            result = {'attributes':server,'meta':{'user_permissions':['file.read','file.create']}}
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def do_POST(self):
        assert self.headers.get('Authorization') == 'Bearer '+KEY
        posts.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        self.wfile.write(b'{"identifier":"native-job"}')

def main():
    api = ThreadingHTTPServer(('127.0.0.1',0),API)
    threading.Thread(target=api.serve_forever,daemon=True).start()
    # Ask the OS for an available driver port, release before starting the driver.
    reservation = ThreadingHTTPServer(('127.0.0.1',0),API)
    port = reservation.server_port
    reservation.server_close()
    session = None
    with tempfile.TemporaryDirectory(prefix='voltra-firefox-smoke-') as temp:
        folder = pathlib.Path(temp)
        profile = folder/'profile'
        profile.mkdir()
        xpi = folder/'companion-test.xpi'
        with zipfile.ZipFile(xpi,'w',zipfile.ZIP_DEFLATED) as archive:
            for path in (ROOT/'dist-firefox').rglob('*'):
                if path.is_file(): archive.write(path,path.relative_to(ROOT/'dist-firefox').as_posix())
        log = open(folder/'geckodriver.log','w',encoding='utf-8')
        driver = subprocess.Popen([str(pathlib.Path(sys.argv[2]).resolve()),'--port',str(port),'--allow-system-access'],stdout=log,stderr=log,
                                  creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))

        def request(method,path,body=None):
            data = None if body is None else json.dumps(body).encode()
            req = urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=data,method=method,
                                         headers={'Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(req,timeout=45) as response:
                    value = json.load(response)['value']
            except urllib.error.HTTPError as error:
                raise RuntimeError(error.read().decode()) from error
            if isinstance(value,dict) and 'error' in value: raise RuntimeError(value)
            return value

        def command(path,body=None): return request('POST',f'/session/{session}'+path,body)
        def js(code): return command('/execute/sync',{'script':code,'args':[]})
        def async_js(code):
            return command('/execute/async',{'script':'const done=arguments[arguments.length-1]; (async()=>{'+code+'})().then(done,e=>done({error:String(e)}));','args':[]})
        def wait(check):
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                try:
                    result=check()
                    if result: return result
                except Exception:
                    pass
                time.sleep(.15)
            raise RuntimeError('Firefox check timed out')
        def start():
            nonlocal session
            capabilities={'browserName':'firefox','moz:firefoxOptions':{
                'binary':str(pathlib.Path(sys.argv[1]).resolve()),
                'args':['-headless','-profile',str(profile)],
                'prefs':{'extensions.webextensions.uuids':json.dumps({ADDON_ID:UUID}),
                         'extensions.webextOptionalPermissionPrompts':False}}}
            response=request('POST','/session',{'capabilities':{'alwaysMatch':capabilities}})
            session=response['sessionId']
            command('/moz/addon/install',{'path':str(xpi),'temporary':True})
            command('/moz/context',{'context':'chrome'})
            js("gBrowser.loadURI(Services.io.newURI('moz-extension://"+UUID+"/app.html'), {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});")
            command('/moz/context',{'context':'content'})
            wait(lambda: js("return document.getElementById('panel') !== null"))
            return response['capabilities']['browserVersion']
        try:
            wait(lambda:request('GET','/status'))
            version=start()
            # Use native WebDriver input and a real click so permissions.request has a user gesture.
            def element(selector): return command('/element',{'using':'css selector','value':selector})['element-6066-11e4-a52e-4f735466cecf']
            def fill(selector,text): command('/element/'+element(selector)+'/value',{'text':text})
            fill('#panel',f'http://127.0.0.1:{api.server_port}')
            fill('#key',KEY)
            command('/element/'+element('#connection button')+'/click',{})
            wait(lambda:js("return !document.getElementById('account').hidden || !document.getElementById('notification-island').hidden"))
            assert js("return !document.getElementById('account').hidden"), js("return document.getElementById('notification-island').innerText")
            assert async_js("return await browser.storage.local.get(null)") == {}, 'Credential leaked into storage.local'
            state=async_js("return await browser.runtime.sendMessage({type:'init'})")
            assert state['data']['connected'] and KEY not in json.dumps(state)
            # Click Firefox's real extension toolbar control; this invokes action.onClicked.
            command('/moz/context',{'context':'chrome'})
            command('/element/'+element('#unified-extensions-button')+'/click',{})
            command('/element/'+element('#voltra-companion_njimgang_org-BAP')+'/click',{})
            command('/moz/context',{'context':'content'})
            sidebar=wait(lambda:async_js("return await browser.sidebarAction.isOpen({})"))
            # Seed a validated mod in the owned fixture's private database to exercise the
            # real background worker, browser fetch/permissions and progress endpoints.
            mod={'module':'fs25','gameVersion':'25','title':'Native test','modVersion':'1',
                 'source':'https://www.farming-simulator.com/mod.php?mod_id=373433&title=fs2025',
                 'url':'https://cdn26.giants-software.com/modHub/storage/00373433/FS25_test.zip','filename':'FS25_test.zip'}
            assert async_js("const db=await new Promise((r,j)=>{const q=indexedDB.open('voltra-companion-private',1);q.onsuccess=()=>r(q.result);q.onerror=j;}); await new Promise((r,j)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put("+json.dumps({'mod':mod,'created':1})+",'request:native-test');t.oncomplete=r;t.onerror=j;});db.close();return true;") is True
            result=async_js("return await browser.runtime.sendMessage({type:'install-all',ids:['native-test'],server:'server-1'})")
            assert result['data']['results'][0]['job']['identifier']=='native-job',result
            assert len(posts)==1 and posts[0]['tracked'] is True and posts[0]['directory']=='/data/mods'
            async_js("return await browser.runtime.sendMessage({type:'queue-progress'})")
            state=async_js("return await browser.runtime.sendMessage({type:'init'})")
            assert state['data']['queue'][0]['job']['state']=='complete'
            request('DELETE',f'/session/{session}')
            session=None
            start()
            restored=async_js("return await browser.runtime.sendMessage({type:'init'})")
            assert restored['data']['connected'] and restored['data']['queue'][0]['job']['state']=='complete',restored
            assert len(posts)==1,'Restart resubmitted a download'
            assert sidebar is True, f'Native toolbar sidebar did not open: {sidebar}'
            print(json.dumps({'firefox':version,'connected':True,'privateStorage':True,'nativeSidebar':sidebar,
                              'batchSubmitted':len(posts),'progress':'complete','browserRestartRetainedState':True}))
        except Exception:
            if session:
                try:
                    print('UI diagnostic:', js("return {text:document.body.innerText,panel:document.getElementById('panel')?.value,keyLength:document.getElementById('key')?.value.length,placeholder:document.getElementById('key')?.placeholder}"))
                    command('/moz/context',{'context':'chrome'})
                    print('Extension errors:',js("return Services.console.getMessageArray().filter(x=>String(x.message).includes('moz-extension')).map(x=>String(x.message)).slice(-10)"))
                except Exception: pass
            raise
        finally:
            if session:
                try: request('DELETE',f'/session/{session}')
                except Exception: pass
            driver.terminate()
            driver.wait(timeout=10)
            log.close()
            api.shutdown()

if __name__=='__main__': main()
