<?php
// Build-time conversion of trusted upstream locale arrays. PHP is not needed at runtime.
$source = dirname(__DIR__, 3) . '/pterodactyl-vite/resources/lang';
$target = dirname(__DIR__, 2) . '/internal/panel/locales';
$count = 0;
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS)) as $file) {
    if ($file->getExtension() !== 'php') continue;
    $relative = substr($file->getPathname(), strlen($source) + 1, -4) . '.json';
    $destination = $target . '/' . str_replace('\\', '/', $relative);
    if (!is_dir(dirname($destination))) mkdir(dirname($destination), 0755, true);
    $data = require $file->getPathname();
    file_put_contents($destination, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
    $count++;
}
echo "Converted {$count} upstream locale files.\n";
