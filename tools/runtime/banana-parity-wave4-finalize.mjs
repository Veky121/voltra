// Refresh only this lane's reports after canonical helper and Linux verification.
import fs from 'node:fs';
import crypto from 'node:crypto';
const folder='artifacts/game-parity-20261029/';
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const [prefix,canonical] of [
  ['banana-wave4','internal/panel/game_library/scripts/banana-native-authority.py'],
  ['craftopia-wave5','internal/panel/game_library/scripts/craftopia-preflight.py'],
]) {
  const file=folder+prefix+'.json';
  const report=JSON.parse(fs.readFileSync(file));
  const linux=JSON.parse(fs.readFileSync(folder+prefix+'-linux.json'));
  if(linux.exit_code!==0||linux.source.sha256!==sha(canonical))throw Error('Missing/stale Linux verification: '+prefix);
  report.scope='New canonical game-specific helper implemented and offline-verified; global override integration and native acceptance remain root-owned';
  report.implementation_status='canonical-helper-ready-for-root-serial-merge';
  report.canonical_source={path:canonical,sha256:sha(canonical)};
  report.linux_evidence={receipt:folder+prefix+'-linux.json',log:folder+prefix+'-linux.log',passed:linux.passed,failures:0,skips:0,
    actual_shared_publication:true,engine:linux.engine,network:linux.network,source_mount:linux.source_mount,memory_mib:256,swap_extra_mib:0,cpus:1};
  report.files=[...new Set([...report.files,canonical,'tools/runtime/banana-parity-wave4-linux.mjs','tools/runtime/banana-parity-wave4-finalize.mjs',folder+prefix+'-linux.json',folder+prefix+'-linux.log'])];
  report.root_integration[0]='Canonical helper is already implemented at '+canonical+'. Stager reads only this canonical source, verifies exact deployed helper bytes, and retains all ordered controls/protected metadata. Root should serial-merge the fresh '+prefix+'-profile.json fragment; no additional candidate copy is needed.';
  if(prefix==='banana-wave4') {
    report.checks=[
      '10 Linux tests passed, zero failures/skips, on the pinned existing Windows Docker Desktop Python image with network none/read-only source/256 MiB/no extra swap/one CPU.',
      'Actual shared native_config.private_write is used, including baseline overwrite reproduction, semantic and byte preservation, missing-field seeding, and unknown large integers/repeated rotation retention.',
      'Twelve invalid native/setup subcases plus invalid existing binary type refuse before installer/configure/supervisor calls.',
      'Native parent symlink refusal tested on Linux without any outside file changes.',
      'Automatic update can repair a missing executable, re-read native values, preserve shared readiness/stop/redaction and propagate nonzero result.',
      'Fresh current-baseline stager and combined profile merge dry-run passed; all eight ordered controls/defaults/permissions unchanged and deployed source bytes equal canonical helper.',
    ];
    report.root_integration[1]='Linux fixture execution now uses the actual portable shared private JSON writer, not a publication shim. This corrects the earlier report that described it as a Linux-only dirfd publisher. Races against hostile concurrent external file replacement remain unverified.';
    report.limits=[
      'Only two newly authorized canonical game-specific helper files and this lane\'s owned tools/reports/fragments changed. No generic helpers, global overrides, Go or frontend source changed.',
      'No game payload acquisition/start, service restart, build, activation, publication or commit. Docker use was limited to bounded offline Python fixtures.',
      'Dynamic native document discovery and legacy STEAM_GSLT API masking remain root integration prerequisites; no guessed static default path was declared.',
      'Historical anonymous No subscription result is not a new entitlement check. Private Steam account transport still fails closed in the shared installer.',
      'Exact bytes remain unchanged on no-op configuration; adding a missing token alias may reserialize native JSON while preserving unknown semantic values.',
    ];
    report.evidence_correction='The first Windows fixtures unnecessarily replaced a portable shared JSON publisher. Current canonical suites remove that shim and validate real publication on Linux.';
  } else {
    report.checks=[
      '12 Linux tests passed, zero failures/skips, under network none/read-only source/256 MiB/no extra swap/one CPU.',
      'The original main reaches mocked acquisition before invalid-port refusal; canonical preflight refuses invalid controls/identities before it.',
      'Actual shared secure byte publication and two repeated configure boots preserve native unknown rows, gameplay values, exact second-boot bytes and 0640 metadata; shared backup files are created.',
      'Native Host/serverPassword values are forwarded to both existing relay and console redactors.',
      'Internal backup-parent symlink refusal and malformed managed aliases/duplicate rows reject before acquisition without changing operator files.',
      'Missing payload/config may be restored by an enabled updater and is strictly replanned; no-update missing payload refuses before configuration.',
      'Mocked supervisor/relay checks retain native-ready marker, SIGINT, relay start/finish and propagated nonzero exit.',
      'Fresh current-baseline stager and combined profile merge dry-run passed; six original ordered controls remain unchanged and deployed source bytes equal canonical helper.',
    ];
    report.root_integration[5]='Actual shared secure publication is now exercised on Linux with repeated-boot and metadata fixtures. Native file-log contents, actual relay threading and real game behavior still require runtime acceptance; fixture relay/supervisor remain mocked.';
    report.limits=[
      'Only newly authorized game-specific canonical helpers and owned lane tools/reports/fragments changed; no generic helpers, global overrides, Go or frontend edits.',
      'No real game acquisition/start, service restart, build, activation, publication, commit or nested delegation. Docker use was bounded offline fixture execution only.',
      'Pure preflight prevents predictable refusal-before-acquisition defects; it does not establish crash-atomic publication or close concurrent external mutation races.',
      'Existing custom savePath values are preserved without introducing a new confinement/retention promise. Custom paths remain unverified.',
      'WORLD_NAME retains setup/Runtime authority and the original first-boot selection behavior. Root managed-field and scoped boolean UI integration remains required.',
    ];
    report.additional_fixes=['Preflight rejects symlinked log/backup parents before acquisition, including in-volume aliases that the shared late writer would refuse.',
      'Effective native Host/serverPassword is included in the unchanged shared relay/console redaction credentials.'];
  }
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:file,canonical,linux_tests:linux.passed,ready:true,native_complete:false}));
}

const backendLog=folder+'banana-wave4-backend-test.log';
if(fs.existsSync(backendLog)) {
  const bytes=fs.readFileSync(backendLog);
  const events=bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(JSON.parse);
  const passed=events.filter(event=>event.Action==='pass'&&event.Test);
  const failed=events.filter(event=>event.Action==='fail');
  const skipped=events.filter(event=>event.Action==='skip'&&event.Test);
  if(failed.length||skipped.length||!events.some(event=>event.Action==='pass'&&!event.Test&&event.Package==='voltra/internal/panel'))throw Error('Backend check incomplete or failed');
  const sources=['internal/panel/game_settings_banana.go','internal/panel/game_settings_banana_test.go',
    'internal/panel/game_settings_craftopia.go','internal/panel/game_settings_craftopia_test.go'];
  const backend={scope:'Implemented new request-context and typed metadata helpers; shared integration/native acceptance still root-owned',complete:false,
    source:sources.map(file=>({path:file,sha256:sha(file)})),
    checks:{command:"go test ./internal/panel -run '^(TestBananaSettings|TestCraftopia|TestNativeSettings|TestSettingsReviewManagedPaths)' -count=1 -json",log:backendLog,
      passed_including_subtests:passed.length,failures:failed.length,skips:skipped.length,
      owned_top_level:passed.filter(event=>!event.Test.includes('/')&&/^Test(BananaSettings|Craftopia)/.test(event.Test)).map(event=>event.Test),
      database:'Existing isolated PostgreSQL 127.0.0.1:55439, per-test fixture schemas; private environment read without printing credentials'},
    implemented:{banana:'Exact recipe, safe runtime-consistent ASCII SERVER folder, effective server override/egg default/runtime fallback, duplicate-row refusal, request cancellation and stale-context fail-closed behavior. Selected-document getter rechecks exact namespace and never scans other folders.',
      craftopia:'Ten source-backed raw unquoted 0/1 bits become boolean metadata with on=1/off=0. Other values, quoted strings, repeated fields and case aliases stay readonly and reject direct patches. Existing byte-span patcher preserves comments/unknown rows/PIN zeros.'},
    root_hooks:[
      'Call a.prepareBananaSettingsEgg(ctx,server,egg) beside STK preparation before shared discovery. Propagate errors instead of silently falling back.',
      'In nativeSettingsDocuments, add only bananaSelectedSettingsDocument(egg) as JSON when nonempty; existing discovery must still prove the file is regular and exists. Do not declare a fixed default SERVER folder or scan all /Servers children.',
      'The runtime permits a selected folder named Mods. The validated dynamic getter handles it as a server folder, not a plugin scan; do not pass it through the unrelated generic mod-folder declaration exclusion.',
      'For PUT, re-resolve selected context after acquiring the existing server-mutation lock and reject if the selected path changed before the file write. Initial discovery context must not authorize writing an inactive previous folder.',
      'On the generic parseGameSettings result in parseGameSettingsForEgg, apply craftopiaSettingsFields(egg,file,data,parsed). The raw data argument prevents quoted/unsupported values from becoming switches.',
      'In response secret metadata, exempt only craftopiaSettingsBit(egg,file,key) from the generic credential-name regex; Host/usePassword is a public flag. Keep actual Host/serverPassword masked. Root extends legacy GSLT masking separately.',
      'Add exact Craftopia recipe/document managed guards for GameWorld/name, Host/port and reviewed Save/savePath policy. Runtime authority and custom save semantics remain explicit.'
    ],
    api_test_draft:[
      'Banana: exact custom SERVER path discovers and GET/PUT succeeds only for selected existing file; default shadow/other folder returns404; invalid/duplicate effective variable rejects without fallback.',
      'Banana: both /Server/Login_Token and /Server/STEAM_GSLT remain absent from serialized values; native name/token/unknown JSON values survive typed edit and restart after entitlement-ready handoff.',
      'Craftopia: Host/usePassword is visible boolean rather than a masked credential, actual serverPassword stays masked with PIN zeros retained; boolean PUT writes only0/1 and preserves unrelated bytes.',
      'Both use shared stopped-only/revision/non-admin read/write checks; actual dispatcher/API tests remain pending root hooks, not claimed by standalone helper tests.'
    ],
    limits:['No existing shared dispatch/regex/frontend/global override source edited by this lane.',
      'No real game acquisition/start, build, restart or activation performed. Backend tests use fixture schemas and simulated Wings, not the active native servers.',
      'Native Banana entitlement/private-Steam prerequisite and both games\' current five native acceptance gates remain incomplete.',
      'Runtime-variable changes concurrent with PUT and global egg-default edits require root handler/locking integration; the pure context helper alone does not provide cross-request file-write atomicity.']};
  const target=folder+'banana-wave4-backend.json';
  fs.writeFileSync(target,JSON.stringify(backend,null,2)+'\n');
  for(const prefix of ['banana-wave4','craftopia-wave5']) {
    const file=folder+prefix+'.json',report=JSON.parse(fs.readFileSync(file));
    report.backend_evidence=target;
    report.backend_status='Four new Go helper/test files implemented; shared hooks pending root serial integration';
    fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  }
  console.log(JSON.stringify({backend:target,passed:passed.length,failures:0,skips:0,native_complete:false}));
}
