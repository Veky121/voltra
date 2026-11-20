import test from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceForm, privateReady, steamVariable, templateForm} from './privateSteamFixtures.mjs';
import {
  clearTemplateSteamSecrets,
  templateSteamDefault,
  templateSteamEnvironment,
  templateSteamRole,
  privateOriginalMaximum,
} from '../src/features/game-library/privateSteamTemplateModel.ts';
import {privateAuthorizationBody, privateGuardReply} from '../src/features/game-library/privateSteamModel.ts';
const pending = {
  default_mode: 'public',
  private_candidate: true,
  private_supported: false,
  private_reason: 'Pending reviewed policy',
  controls: {},
  coverage: 'pending',
};
test('KF2 initial public choice and Banana existing private default are independent', () => {
  assert.equal(templateSteamDefault(pending, false), false);
  assert.equal(templateSteamDefault({...pending, default_mode: 'private', private_supported: true}, true), true);
  assert.equal(templateSteamDefault(undefined, true), true);
  assert.equal(templateSteamDefault(undefined, false), false);
});
test('both original alias families are recognized without classifying game flags or tokens as passwords', () => {
  for (const [name, role] of Object.entries({
    STEAM_USER: 'username',
    STEAM_USERNAME: 'username',
    STEAM_PASS: 'password',
    STEAM_PASSWORD: 'password',
    STEAM_AUTH: 'guard',
    STEAM_GUARDCODE: 'guard',
    SRCDS_BETAID: 'branch',
    SRCDS_BETAPASS: 'beta_password',
  }))
    assert.equal(templateSteamRole(name), role);
  for (const name of ['PASSWORD', 'EXTRA_FLAGS', 'STEAM_GSLT', 'SERVER_NAME'])
    assert.equal(templateSteamRole(name), '');
});
test('mode switches clear every Steam secret alias while retaining literal game controls and public branch', () => {
  const input = {
    STEAM_USERNAME: 'user',
    STEAM_PASSWORD: ' x ',
    STEAM_GUARDCODE: '123456',
    STEAM_USER: 'anonymous',
    STEAM_PASS: 'secret',
    STEAM_AUTH: 'code',
    SRCDS_BETAPASS: 'beta',
    SRCDS_BETAID: 'preview',
    PASSWORD: 'game password',
    EXTRA_FLAGS: '-log',
    MAX_PLAYER: '6',
  };
  const safe = clearTemplateSteamSecrets(input);
  assert.equal(input.STEAM_PASSWORD, ' x ');
  for (const key of [
    'STEAM_USERNAME',
    'STEAM_PASSWORD',
    'STEAM_GUARDCODE',
    'STEAM_PASS',
    'STEAM_AUTH',
    'SRCDS_BETAPASS',
  ])
    assert.equal(safe[key], '');
  assert.equal(safe.STEAM_USER, 'anonymous');
  assert.equal(safe.PASSWORD, input.PASSWORD);
  assert.equal(safe.SRCDS_BETAID, 'preview');
  assert.equal(safe.EXTRA_FLAGS, '-log');
  assert.equal(templateSteamEnvironment(safe, true).STEAM_USER, '');
});
test('ordinary submission refuses credentials including whitespace and mixed account modes before serialization', () => {
  for (const key of [
    'STEAM_USER',
    'STEAM_USERNAME',
    'STEAM_PASS',
    'STEAM_PASSWORD',
    'STEAM_AUTH',
    'STEAM_GUARDCODE',
    'SRCDS_BETAPASS',
  ])
    for (const value of [' ', ' anonymous ', 'literal +quit " ?']) {
      assert.throws(() => templateSteamEnvironment({[key]: value}, false), /Steam maintenance/);
    }
  assert.deepEqual(templateSteamEnvironment({STEAM_USER: 'anonymous', STEAM_PASS: '', PASSWORD: 'game'}, false), {
    STEAM_USER: 'anonymous',
    STEAM_PASS: '',
    PASSWORD: 'game',
  });
});
test('secure authorization preserves original literal values and applies only declared original length limits', () => {
  const controls = {
    username: [{environment: 'STEAM_USERNAME', label: 'Steam User', rules: 'required|string|max:64'}],
    password: [{environment: 'STEAM_PASSWORD', label: 'Steam Password', rules: 'required|string|max:64'}],
  };
  const username = '  user ? +quit  ',
    password = '  secret " \\ ?\n  ';
  assert.deepEqual(privateAuthorizationBody(username, true, password, controls), {
    username,
    password,
    save_password: true,
  });
  assert.throws(() => privateAuthorizationBody('x'.repeat(65), true, password, controls), /original maximum/);
  assert.equal(privateAuthorizationBody('x'.repeat(100), false, '', {}).username.length, 100);
});
test('original Guard max6 is challenge-scoped and never limits device confirmation or unrelated recipes', () => {
  const now = 1000,
    guard = {
      challenge_id: 'challenge',
      kind: 'email_code',
      expires_at: new Date(2000).toISOString(),
      code_controls: [{environment: 'STEAM_AUTH', label: 'Steam Auth', rules: 'nullable|string|max:6'}],
    };
  assert.equal(privateOriginalMaximum(guard.code_controls), 6);
  assert.equal(privateGuardReply(guard, {code: ' 12? '}, now).code, ' 12? ');
  assert.equal(
    privateGuardReply(guard, {code: String.fromCodePoint(0x1f600).repeat(6)}, now).code,
    String.fromCodePoint(0x1f600).repeat(6)
  );
  assert.throws(() => privateGuardReply(guard, {code: '1234567'}, now), /original maximum/);
  assert.equal(privateGuardReply({...guard, code_controls: undefined}, {code: '1234567'}, now).code, '1234567');
  assert.deepEqual(privateGuardReply({...guard, kind: 'device_confirmation'}, {accepted: false}, now), {
    challenge_id: 'challenge',
    kind: 'device_confirmation',
    accepted: false,
  });
});
test('actual shared form submits sanitized values, hides both credential alias families and retains generic game controls', async () => {
  const f = templateForm();
  const options = privateReady([
    steamVariable('STEAM_USERNAME', 'anonymous'),
    steamVariable('STEAM_USER', 'anonymous'),
    steamVariable('STEAM_PASSWORD', '', {rules: 'required|string'}),
    steamVariable('STEAM_PASS', '', {rules: 'required|string'}),
    steamVariable('SRCDS_BETAID', 'public', {rules: 'required|string'}),
    {
      name: 'Game player limit',
      env_variable: 'MAX_PLAYER',
      default_value: '',
      rules: 'required|integer',
      user_viewable: true,
    },
  ]);
  const view = f.mount(options);
  // The Steam mode starts from the template's own default.
  assert.equal(view.find(n => n.type === 'select' && n.props.id === 'game-template-steam').props.value, 'private');
  // Credential variables of either alias family get no input, even when required; the branch and game controls stay.
  const ids = view.findAll(n => n.type === 'input' && n.props.id?.startsWith('game-template-')).map(n => n.props.id);
  assert.deepEqual(ids.sort(), ['game-template-MAX_PLAYER', 'game-template-SRCDS_BETAID']);
  assert.match(view.text(), /Game player limit/);
  view.change(
    view.find(n => n.props.id === 'game-template-MAX_PLAYER'),
    '8'
  );
  await view.submit(view.find(n => n.type === 'form'));
  assert.equal(f.requests.length, 1);
  const {environment} = f.requests[0].body;
  // Private installs blank every credential, including the anonymous account name.
  assert.deepEqual(environment, {
    STEAM_USERNAME: '',
    STEAM_USER: '',
    STEAM_PASSWORD: '',
    STEAM_PASS: '',
    SRCDS_BETAID: 'public',
    MAX_PLAYER: '8',
  });
  assert.equal(f.requests[0].body.private_content, true);
  // The port preview asks with the same sanitized values.
  assert.deepEqual(f.ports.at(-1), {node: '1', environment, enabled: true});
});

test('summary acceptance starts off, updates readiness and submits the egg value', async () => {
  const f = templateForm();
  const options = privateReady([steamVariable('POT_HOSTING_AGREEMENT', '1', {rules: 'required|boolean'})]);
  options.acceptances = [
    {
      environment: 'POT_HOSTING_AGREEMENT',
      title: 'Hosting Agreement',
      url: 'https://example.invalid/terms',
      accept_value: '1',
    },
  ];
  const view = f.mount(options);
  const toggle = () => view.find(n => n.props.id === 'game-template-POT_HOSTING_AGREEMENT');
  assert.equal(toggle().props['aria-checked'], false);
  assert.equal(f.disabled(view), true);
  assert.ok(view.find(n => n.props.href === '#game-template-POT_HOSTING_AGREEMENT'));
  view.change(toggle(), true);
  assert.equal(f.disabled(view), false);
  view.change(toggle(), false);
  assert.equal(f.disabled(view), true);
  view.change(toggle(), true);
  await view.submit(view.find(n => n.type === 'form'));
  assert.equal(f.requests[0].body.environment.POT_HOSTING_AGREEMENT, '1');
});
test('a corrected invalid default stays in the creation form', () => {
  const f = templateForm();
  const name = {
    name: 'Server name',
    env_variable: 'SC_NAME',
    default_value: 'x'.repeat(41),
    rules: 'required|string|max:40',
    user_viewable: true,
  };
  const view = f.mount(privateReady([name]));
  assert.ok(f.disabled(view));
  view.change(
    view.find(n => n.props.id === 'game-template-SC_NAME'),
    'Short name'
  );
  // Decided from the original default, so fixing the value does not remove the field.
  assert.equal(view.find(n => n.props.id === 'game-template-SC_NAME').props.value, 'Short name');
  assert.ok(!f.disabled(view));
});
test('Steam maintenance submits authorizations through the shared body and clears one-time secrets', async () => {
  const controls = {
    username: [{environment: 'STEAM_USERNAME', label: 'Steam User', rules: 'required|string|max:12'}],
    password: [{environment: 'STEAM_PASSWORD', label: 'Steam Password', rules: 'required|string|max:64'}],
    beta_password: [{environment: 'SRCDS_BETAPASS', label: 'Beta Password', rules: 'nullable|string|max:64'}],
  };
  const f = maintenanceForm();
  const view = f.mount(controls);
  const account = () => view.find(n => n.type === 'input' && n.props.autoComplete === 'off' && n.props.required);
  // Over the original username limit: the shared body refuses it before any request.
  view.change(account(), 'x'.repeat(13));
  await view.submit(view.find(n => n.type === 'form' && n.children.some(c => c.type === 'fieldset')));
  assert.equal(f.requests.length, 0);
  assert.match(view.text(), /original maximum/);
  view.change(account(), '  user ? ');
  view.change(
    view.find(n => n.props.role === 'switch'),
    true
  );
  view.change(
    view.find(n => n.type === 'input' && n.props.autoComplete === 'new-password'),
    ' secret '
  );
  await view.submit(view.find(n => n.type === 'form' && n.children.some(c => c.type === 'fieldset')));
  assert.deepEqual(f.requests.at(-1), {
    path: '/api/client/servers/s/steam/private/authorizations',
    method: 'POST',
    body: privateAuthorizationBody('  user ? ', true, ' secret ', controls),
  });
  // A job with a branch password: both one-time secrets are gone afterwards, success or not.
  for (const outcome of ['ok', 'fail']) {
    f.fail = outcome === 'fail';
    const secret = view.findAll(
      n => n.type === 'input' && n.props.type === 'password' && n.props.autoComplete === 'off'
    );
    assert.equal(secret.length, 2);
    view.change(secret[0], 'job password');
    view.change(secret[1], 'beta password');
    await view.click(view.find(n => n.type === 'button' && view.text(n) === 'Install'));
    assert.deepEqual(f.requests.at(-1).body, {
      authorization_id: 'auth-1',
      operation: 'install',
      branch: 'public',
      password: 'job password',
      beta_password: 'beta password',
    });
    for (const input of view.findAll(
      n => n.type === 'input' && n.props.type === 'password' && n.props.autoComplete === 'off'
    ))
      assert.equal(input.props.value, '');
  }
});
test('known Holdfast private beta carriers and raw installer flags never enter ordinary submission or port preview', () => {
  const descriptor = {...pending, legacy_branch_field: 'EXTRA_FLAGS'};
  for (const value of ['', ' ', '-beta public', '"-beta" \'pre\'view', '-beta name-betapassword'])
    assert.equal(templateSteamEnvironment({EXTRA_FLAGS: value}, false, descriptor).EXTRA_FLAGS, value);
  for (const value of [
    '-beta preview -betapassword secret',
    "'-beta' 'public' '-betapassword' 'opaque literal'",
    "-beta public -betapass'word' secret",
    '-beta preview -unknown secret',
    "-beta 'unterminated",
  ]) {
    assert.throws(() => templateSteamEnvironment({EXTRA_FLAGS: value}, false, descriptor), /Steam|branch/);
    assert.equal(clearTemplateSteamSecrets({EXTRA_FLAGS: value}, descriptor).EXTRA_FLAGS, '');
  }
  assert.equal(
    templateSteamEnvironment({EXTRA_FLAGS: '-beta preview -betapassword nativeflag'}, false).EXTRA_FLAGS,
    '-beta preview -betapassword nativeflag'
  );
  assert.throws(() => templateSteamEnvironment({INSTALL_FLAGS: ' +login private'}, false), /Raw Steam/);
});
test('raw installer flags never reach the port preview or the create request', async () => {
  const f = templateForm();
  const view = f.mount(
    privateReady(
      [
        {
          name: 'Install flags',
          env_variable: 'INSTALL_FLAGS',
          default_value: '+login private',
          rules: 'nullable|string',
          user_viewable: true,
        },
      ],
      false
    )
  );
  assert.match(view.text(), /Raw Steam installation flags are unsupported/);
  assert.deepEqual(f.ports.at(-1), {node: '1', environment: {}, enabled: false});
  assert.ok(f.disabled(view));
  await view.submit(view.find(n => n.type === 'form'));
  assert.equal(f.requests.length, 0);
});
