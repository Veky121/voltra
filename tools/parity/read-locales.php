<?php
declare(strict_types=1);

$directory = realpath($argv[1] ?? '');
if ($directory === false || !is_dir($directory)) {
    fwrite(STDERR, "The reference translation directory is missing.\n");
    exit(1);
}
$result = [];
foreach (glob($directory . '/*.php') as $file) {
    $result[basename($file, '.php')] = require $file;
}
echo json_encode($result, JSON_THROW_ON_ERROR);
