<?php
declare(strict_types=1);
require $argv[1] . '/vendor/autoload.php';
$factory = new Illuminate\Validation\Factory(new Illuminate\Translation\Translator(new Illuminate\Translation\ArrayLoader(), 'en'));
$languages = array_map('basename', glob($argv[1] . '/resources/lang/*', GLOB_ONLYDIR));
$cases = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$output = [];
foreach ($cases as $case) {
    $field = $case['field'];
    switch ($case['kind']) {
        case 'users':
            $column = ['first_name' => 'name_first', 'last_name' => 'name_last'][$field] ?? $field;
            $rules = explode('|', Pterodactyl\Models\User::$validationRules[$column]);
            if ($field === 'username') $rules[] = new Pterodactyl\Rules\Username();
            if ($field === 'language') $rules[] = Illuminate\Validation\Rule::in($languages);
            break;
        case 'locations': $rules = explode('|', Pterodactyl\Models\Location::$validationRules[$field]); break;
        case 'nodes':
            $column = ['daemon_listen' => 'daemonListen', 'daemon_sftp' => 'daemonSFTP', 'daemon_base' => 'daemonBase'][$field] ?? $field;
            $rules = explode('|', Pterodactyl\Models\Node::$validationRules[$column]); break;
        case 'database-hosts': $rules = explode('|', Pterodactyl\Models\DatabaseHost::$validationRules[$field]); break;
        case 'nests':
            $request = new Pterodactyl\Http\Requests\Admin\Nest\StoreNestFormRequest();
            $rules = explode('|', $request->rules()[$field]); break;
        case 'eggs':
            $request = new Pterodactyl\Http\Requests\Admin\Egg\EggFormRequest();
            $request->setMethod('POST');
            $rules = $request->rules()[$field];
            $rules = is_array($rules) ? $rules : explode('|', $rules); break;
        case 'variables':
            $request = new Pterodactyl\Http\Requests\Admin\Egg\EggVariableFormRequest();
            $rules = explode('|', $request->rules()[$field]); break;
        default: throw new RuntimeException('Unrecognized DTO oracle source');
    }
    // Isolate field validation. Independent suites check DB-backed constraints.
    $rules = array_values(array_filter($rules, static fn ($rule) => !is_string($rule) || !preg_match('/^(unique|exists):/', $rule)));
    $data = ($case['present'] ?? true) ? [$field => $case['value']] : [];
    $request = Illuminate\Http\Request::create('/fixture', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/json'], json_encode($data, JSON_THROW_ON_ERROR));
    $data = (new Pterodactyl\Http\Middleware\TrimStrings())->handle($request, static fn ($trimmed) =>
        (new Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull())->handle($trimmed, static fn ($normalized) => $normalized->all()));
    $output[] = ['id' => $case['id'], 'native_passes' => $factory->make($data, [$field => $rules])->passes(), 'source' => $case['kind'], 'field' => $field];
}
echo json_encode($output, JSON_THROW_ON_ERROR);
