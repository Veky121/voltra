<?php
declare(strict_types=1);
require $argv[1] . '/vendor/autoload.php';

$translator = new Illuminate\Translation\Translator(new Illuminate\Translation\ArrayLoader(), 'en');
$factory = new Illuminate\Validation\Factory($translator);
$cases = [
    ['name' => 'multiple-integer', 'rule' => 'required|integer|multiple_of:2', 'valid' => '4', 'invalid' => '3'],
    ['name' => 'multiple-decimal', 'rule' => 'required|numeric|multiple_of:0.1', 'valid' => '0.3', 'invalid' => '0.31'],
    ['name' => 'hex-three', 'rule' => 'required|string|hex_color', 'valid' => '#abc', 'invalid' => 'abc'],
    ['name' => 'hex-four', 'rule' => 'required|string|hex_color', 'valid' => '#abcd', 'invalid' => '#abcde'],
    ['name' => 'hex-six', 'rule' => 'required|string|hex_color', 'valid' => '#00ff00', 'invalid' => 'not-a-color'],
    ['name' => 'hex-eight', 'rule' => 'required|string|hex_color', 'valid' => '#00ff00ff', 'invalid' => '#00ff00fff'],
    ['name' => 'mac-colon', 'rule' => 'required|string|mac_address', 'valid' => '00:11:22:33:44:55', 'invalid' => 'not-a-mac'],
    ['name' => 'mac-hyphen', 'rule' => 'required|string|mac_address', 'valid' => '00-11-22-33-44-55', 'invalid' => '00:11-22:33:44:55'],
    ['name' => 'filled', 'rule' => 'filled|string', 'valid' => 'nonempty', 'valid_http' => " \t nonempty \n", 'invalid' => ''],
    ['name' => 'date-equals', 'rule' => 'required|date_equals:2026-10-21', 'valid' => '2026-10-21', 'invalid' => '2026-10-22'],
    ['name' => 'timezone', 'rule' => 'required|timezone', 'valid' => 'Europe/Berlin', 'invalid' => 'Mars/Anywhere'],
    ['name' => 'timezone-country', 'rule' => 'required|timezone:PER_COUNTRY,DE', 'valid' => 'Europe/Berlin', 'invalid' => 'Europe/Paris'],
    ['name' => 'ulid', 'rule' => 'required|ulid', 'valid' => '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'invalid' => 'not-a-ulid'],
    ['name' => 'regex-endonly', 'rule' => 'required|string|regex:/^foo$/D', 'valid' => 'foo', 'valid_http' => "foo\n", 'invalid' => "foo\n", 'invalid_http' => "foo\nbar"],
    ['name' => 'regex-ungreedy', 'rule' => 'required|string|regex:/^(?=(a+))\1a$/U', 'valid' => 'aa', 'invalid' => 'aaa'],
    ['name' => 'regex-duplicate-names', 'rule' => 'required|string|regex:/^(?<part>a)(?<part>b)$/J', 'valid' => 'ab', 'invalid' => 'ac'],
    ['name' => 'accepted-if', 'rule' => 'accepted_if:environment.OTHER,yes', 'environment' => ['OTHER' => 'yes'], 'valid' => 'yes', 'invalid' => 'no'],
    ['name' => 'declined-if', 'rule' => 'declined_if:environment.OTHER,yes', 'environment' => ['OTHER' => 'yes'], 'valid' => 'no', 'invalid' => 'yes'],
    ['name' => 'required-if-accepted', 'rule' => 'required_if_accepted:environment.OTHER', 'environment' => ['OTHER' => 'yes'], 'valid' => 'present', 'invalid' => ''],
    ['name' => 'required-if-declined', 'rule' => 'required_if_declined:environment.OTHER', 'environment' => ['OTHER' => 'no'], 'valid' => 'present', 'invalid' => ''],
    ['name' => 'prohibited-if', 'rule' => 'prohibited_if:environment.OTHER,blocked', 'environment' => ['OTHER' => 'blocked'], 'valid' => '', 'invalid' => 'present'],
    ['name' => 'email-strict', 'rule' => 'required|email:strict', 'valid' => 'a@example.com', 'invalid' => '"quoted"@example.com'],
    ['name' => 'email-filter', 'rule' => 'required|email:filter', 'valid' => 'a@example.com', 'invalid' => 'ü@example.com'],
    ['name' => 'email-filter-unicode', 'rule' => 'required|email:filter_unicode', 'valid' => 'ü@example.com', 'invalid' => 'a@bücher.de'],
    ['name' => 'email-spoof', 'rule' => 'required|email:spoof', 'valid' => '用户@example.com', 'invalid' => 'а@example.com'],
    ['name' => 'email-rfc-spoof', 'rule' => 'required|email:rfc,spoof', 'valid' => '用户@example.com', 'invalid' => 'a..b@example.com'],
];
foreach ($cases as &$case) {
    $valid = ['environment' => array_merge($case['environment'] ?? [], ['PARITY_RULE' => $case['valid']])];
    $invalid = ['environment' => array_merge($case['environment'] ?? [], ['PARITY_RULE' => $case['invalid']])];
    $rules = ['environment.PARITY_RULE' => $case['rule']];
    $case['native_valid_passes'] = $factory->make($valid, $rules)->passes();
    $case['native_invalid_rejected'] = $factory->make($invalid, $rules)->fails();
    $normalize = static function (array $data): array {
        $request = Illuminate\Http\Request::create('/api/application/servers/fixture/startup', 'PATCH', [], [], [], ['CONTENT_TYPE' => 'application/json'], json_encode($data, JSON_THROW_ON_ERROR));
        return (new Pterodactyl\Http\Middleware\TrimStrings())->handle($request, static fn ($trimmed) =>
            (new Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull())->handle($trimmed, static fn ($normalized) => $normalized->all()));
    };
    $validHTTP = $normalize(['environment' => array_merge($case['environment'] ?? [], ['PARITY_RULE' => $case['valid_http'] ?? $case['valid']])]);
    $invalidHTTP = $normalize(['environment' => array_merge($case['environment'] ?? [], ['PARITY_RULE' => $case['invalid_http'] ?? $case['invalid']])]);
    $case['native_http_valid_passes'] = $factory->make($validHTTP, $rules)->passes();
    $case['native_http_invalid_rejected'] = $factory->make($invalidHTTP, $rules)->fails();
    $case['native_http_valid_normalized_value'] = $validHTTP['environment']['PARITY_RULE'];
}
echo json_encode($cases, JSON_THROW_ON_ERROR);
