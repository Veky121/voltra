<?php
// Development oracle only. The Go production binary never invokes PHP.
$cases = json_decode(file_get_contents(__DIR__ . '/oracle-cases.json'), true, flags: JSON_THROW_ON_ERROR);
foreach ($cases as &$case) {
    $subject = isset($case['subject_base64']) ? base64_decode($case['subject_base64']) : $case['subject'];
    $result = @preg_match($case['pattern'], $subject);
    $case['result'] = $result;
    $case['error_code'] = preg_last_error();
    $case['error_message'] = preg_last_error_msg();
}
echo json_encode(['php_version'=>PHP_VERSION, 'pcre_version'=>PCRE_VERSION, 'cases'=>$cases], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), PHP_EOL;
