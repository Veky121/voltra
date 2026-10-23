<?php
// Development oracle only; neither the Go application nor Go tests invoke PHP.
require __DIR__ . '/../../../../pterodactyl-vite/vendor/autoload.php';
use Illuminate\Validation\Factory;
use Illuminate\Translation\Translator;
use Illuminate\Translation\ArrayLoader;
use Carbon\Carbon;
$factory = new Factory(new Translator(new ArrayLoader(), 'en'));
$cases = json_decode(file_get_contents(__DIR__.'/oracle-cases.json'), true, flags: JSON_THROW_ON_ERROR);
foreach ($cases as &$case) {
    date_default_timezone_set($case['timezone'] ?? 'UTC');
    Carbon::setTestNow(Carbon::parse('2026-10-21T10:15:30.123456Z'));
    $data = ['value'=>$case['value']] + ($case['environment'] ?? []);
    $rules = ['value'=>$case['rules']] + ($case['other_rules'] ?? []);
    try {
        $validator = $factory->make($data, $rules);
        $case['valid'] = $validator->passes();
        $case['failed'] = $validator->failed();
    } catch (Throwable $e) { $case['exception'] = get_class($e).': '.$e->getMessage(); }
    if (is_string($case['value']) || is_numeric($case['value'])) {
        $format = null;
        foreach (explode('|',$case['rules']) as $rule) {
            if (str_starts_with($rule,'date_format:')) { $format = explode(',',substr($rule,12))[0]; break; }
        }
        try {
            $date = $format === null ? null : DateTime::createFromFormat('!'.$format,$case['value']);
            if (!$date) $date = Carbon::parse($case['value']);
            $case['parsed'] = ['seconds'=>$date->getTimestamp(),'micros'=>(int)$date->format('u')];
        } catch (Throwable $e) { $case['parsed'] = null; }
    }
}
echo json_encode(['php_version'=>PHP_VERSION,'timelib_version'=>202215,'timezone_db'=>timezone_version_get(),'base'=>'2026-10-21T10:15:30.123456Z','cases'=>$cases],JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),"\n";
