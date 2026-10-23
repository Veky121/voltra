"""Fresh public acquisition/validation utility. This never executes a game binary."""
import argparse, hashlib, json, os, re, subprocess, sys, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import importlib.util
spec=importlib.util.spec_from_file_location('gamecache',Path(__file__).with_name('steam-game-cache.py'));cache=importlib.util.module_from_spec(spec);spec.loader.exec_module(cache)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--work',type=Path,required=True);parser.add_argument('--cache',type=Path,required=True);parser.add_argument('--appid',type=int,required=True);parser.add_argument('--mod',default='');parser.add_argument('--platform',choices=['linux','windows'],default='linux');parser.add_argument('--steamcmd',type=Path,required=True);parser.add_argument('--validation-only',action='store_true');parser.add_argument('--resume-pristine',action='store_true');parser.add_argument('--cache-object');parser.add_argument('--bootstrap-sha256',required=True);parser.add_argument('--bootstrap-at',required=True);args=parser.parse_args()
    if not 1<=args.appid<2**31 or (args.appid==90 and not re.fullmatch('[a-z0-9_]{1,32}',args.mod)) or (args.appid!=90 and args.mod):raise ValueError('Invalid public application/mod selection')
    root=args.work.resolve();payload=root/'payload';request={'appid':args.appid,'branch':'public','platform':args.platform,'mod':args.mod}
    if not args.validation_only and not args.resume_pristine and payload.exists():raise ValueError('Fresh acquisition requires an absent payload directory')
    if (root/'proof.json').exists():raise ValueError('Existing native proof; observe it instead of rerunning')
    payload.mkdir(exist_ok=True)
    command=[str(args.steamcmd),'+@ShutdownOnFailedCommand','1','+@NoPromptForPassword','1','+force_install_dir',str(payload)]
    if args.platform=='windows':command+=['+@sSteamCmdForcePlatformType','windows']
    command+=['+login','anonymous','+app_info_update','1','+app_info_print',str(args.appid)]
    if args.mod:command+=['+app_set_config','90','mod',args.mod]
    command+=['+app_update',str(args.appid),'validate','+quit']
    env={key:value for key,value in os.environ.items() if not any(token in key.upper() for token in ['PASS','AUTH','TOKEN','STEAM_USER'])};env['HOME']=str(root)
    with cache.locked(args.cache):
        if cache.usage(args.cache)>cache.CAPACITY-2*1024**3:raise ValueError('Insufficient total shared cache acquisition headroom')
        if not args.resume_pristine:
            staged=subprocess.run(['python3','/helpers/cache-steamcmd.py','--root',str(root),'--blob','/bootstrap.tar.gz','--sha256',args.bootstrap_sha256,'--source','https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz','--acquired-at',args.bootstrap_at,'--public-manifest','/public-manifest.json'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            if staged.returncode:raise ValueError('Reviewed public SteamCMD staging failed: '+staged.stderr)
        elif not (root/'native.log').is_file():raise ValueError('No bounded pristine acquisition to resume')
        started=time.monotonic()
        def received():
            return sum(int(line.split(':',1)[1].split()[0]) for line in Path('/proc/net/dev').read_text().splitlines() if ':' in line and line.split(':',1)[0].strip()!='lo')
        network_before=received()
        with (root/'native.log').open('wb') as log:
            child=subprocess.Popen(command,cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            try:
                while child.poll() is None:
                    if cache.usage(root)>1800*1024**2 or cache.usage(args.cache)>cache.CAPACITY or time.monotonic()-started>900:
                        child.terminate();child.wait(timeout=30);raise ValueError('Native utility resource/time bound reached; no cache published')
                    time.sleep(1)
            finally:
                if child.poll() is None:child.terminate();child.wait(timeout=30)
        text=(root/'native.log').read_text(errors='replace')
        success="Success! App '"+str(args.appid)+"' fully installed."
        if child.returncode or success not in text or 'Connecting anonymously to Steam Public' not in text or 'Checking for available updates' not in text:raise ValueError('Native anonymous publisher validation incomplete')
        candidates=list(root.rglob('appmanifest_'+str(args.appid)+'.acf'))
        if len(candidates)!=1:raise ValueError('Ambiguous/missing native appmanifest')
        payload_matches_cache=None
        if args.validation_only:
            if not cache.HEX.fullmatch(args.cache_object or ''):raise ValueError('Immutable seeded object identity required')
            published=cache.verify(args.cache/'steam-games/objects'/args.cache_object);key=published['key'];primary,_=cache.metadata(candidates[0],request,True)
            if primary['buildid']!=key['buildid'] or any(key['depots'].get(depot)!=manifest for depot,manifest in primary['depots'].items()):raise ValueError('Publisher selection changed after seeding')
            actual,_=cache.inventory(payload);expected=published['files']
            payload_matches_cache=set(actual)==set(expected) and all(actual[name]['sha256']==meta['sha256'] and actual[name]['bytes']==meta['bytes'] for name,meta in expected.items())
            if not payload_matches_cache:raise ValueError('Publisher validation changed payload; cache is stale for this selection')
        else:key,_=cache.metadata_tree(candidates[0],request)
        proof={'request':request,'appid':args.appid,'anonymous':True,'game_booted':False,'pristine':not args.validation_only,'validation_only':args.validation_only,'exit_code':child.returncode,'elapsed_ms':round((time.monotonic()-started)*1000),'network_received_bytes':received()-network_before,'download_progress_lines':len(re.findall(r'Update state .*downloading',text)),'command':command[1:],'appmanifest':str(candidates[0].relative_to(root)),'native_log_sha256':cache.digest(root/'native.log'),'publisher_update_check':True,'publisher_app_update_validate':True,'native_key':key,'full_payload_matches_seeded_cache_after_publisher_check':payload_matches_cache,'acquired_at':time.time()}
        cache.atomic(root/'proof.json',cache.canonical(proof));print(json.dumps(proof))
if __name__=='__main__':main()
