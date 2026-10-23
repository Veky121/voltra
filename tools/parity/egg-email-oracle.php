<?php
require dirname(__DIR__, 3) . '/pterodactyl-vite/vendor/autoload.php';

use Egulias\EmailValidator\EmailValidator;
use Egulias\EmailValidator\Validation\RFCValidation;
use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory;
use Illuminate\Container\Container;

$container = new Container();
Container::setInstance($container);
$factory = new Factory(new Translator(new ArrayLoader(), 'en'), $container);
$values = [
    'test@example.com', 'a+b@example.com', 'simple@localhost', 'a@example', 'a@1.2.3.4',
    'a@[127.0.0.1]', 'a@[IPv6:2001:db8::1]', 'a@[some literal]', 'a@[IPv6:bad]',
    '"quoted"@example.com', '"a b"@example.com', '"a@b"@example.com', '""@example.com',
    '"a\\\"b"@example.com', 'a(comment)@example.com', '(comment)a@example.com',
    'a@(comment)example.com', 'a@example.com(comment)', 'a@exam(comment)ple.com',
    ' a@example.com', 'a@example.com ', 'a @example.com', 'a@ example.com', 'a\t@example.com',
    'a b@example.com', 'a..b@example.com', '.a@example.com', 'a.@example.com',
    'a@example..com', 'a@-example.com', 'a@example-.com', 'a@exam_ple.com',
    'a@example.c', 'a@example.123', 'a@123', 'a@example.com.', 'a@@example.com',
    'Name <a@example.com>', 'a@example.com,b@example.com', 'a/b@example.com',
    "a\rb@example.com", "a\nb@example.com", "a\r\n@example.com", "a\0b@example.com",
    'ü@example.com', '用户@example.com', 'a@bücher.de', '用户@例子.广告', 'a@😄.com',
    'а@example.com', 'a@раypal.com', 'a@π.com', 'a@a。com', 'a@xn--bcher-kva.de',
    str_repeat('a', 64).'@example.com', str_repeat('a', 65).'@example.com',
    'a@'.str_repeat('a', 63).'.com', 'a@'.str_repeat('a', 64).'.com',
    str_repeat('a', 190).'@'.str_repeat('b', 63).'.com',
    'a@'.str_repeat('a.', 126).'b', false, 123, null, '',
];
$parameterSets = [[], ['rfc'], ['strict'], ['filter'], ['filter_unicode'], ['rfc','strict'], ['rfc','filter'], ['arbitrary'], ['RFC'], ['spoof'], ['dns']];
for($i=0;$i<128;$i++){
    $values[]='a'.chr($i).'b@example.com';
    $values[]='a@ex'.chr($i).'ample.com';
    $values[]='"a'.chr($i).'b"@example.com';
}
$values=array_merge($values,[
    'a(c)b@example.com','a(c)@example.com','a((nested))@example.com','a(c)(d)@example.com',
    'a@ex(c)ample.com','a@example(c).com','a@example.com(c)','a@(c)example.com',
    'a@(c).com','a@ex(c)-ample.com','a@ex(c)-.com','a@ex(c)am_ple.com',
    'a@[]','a@[bad]','a@[127.000.000.001]','a@[IPv6:::1]','a@[bad]trailing',
    '"x".y@example.com','x."y"@example.com','"x"(c)@example.com','"x" @example.com',
    'a @example.com',"a\t@example.com",'a  @example.com', 'a@a。com',
    'a@faß.de','πー@π.π',"π\u{0342}@π.π","a\u{0342}@example.com",'アー@example.com',
    'a@a¿.com','a@a¡.com','a¿b@example.com','a¡b@example.com',
]);
$cases=[];
foreach($values as $value){
    foreach($parameterSets as $parameters){
        // Public DNS is tested separately with controlled records. Only reserved
        // domains are queried here, which native Egulias rejects before DNS IO.
        if(in_array('dns',$parameters,true) && $value !== 'a@example' && $value !== 'a@example.invalid') continue;
        $row=['value'=>$value,'parameters'=>$parameters];
        try {
            $rule='email'.($parameters ? ':'.implode(',',$parameters) : '');
            $validator=$factory->make(['value'=>$value],['value'=>['required',$rule]]);
            $row['valid']=$validator->passes();
        } catch(Throwable $error){$row['exception']=get_class($error);$row['detail']=$error->getMessage();}
        if(is_string($value)){
            $validation=new RFCValidation();(new EmailValidator())->isValid($value,$validation);
            $row['rfc_warnings']=array_values(array_map(fn($warning)=>get_class($warning),$validation->getWarnings()));
        }
        $cases[]=$row;
    }
}
foreach(file(__DIR__.'/../../artifacts/parity/egg-email-ScriptExtensions-17.txt') as $line){
    $line=trim(explode('#',$line)[0]);if(!$line)continue;
    $code=hexdec(explode('..',trim(explode(';',$line)[0]))[0]);$character=IntlChar::chr($code);
    foreach([$character.'@example.com','π'.$character.'@π.π'] as $value){
        $parameters=['spoof'];$validator=$factory->make(['value'=>$value],['value'=>['required','email:spoof']]);$cases[]=['value'=>$value,'parameters'=>$parameters,'valid'=>$validator->passes()];
    }
}
class ControlledEmailDNS extends Egulias\EmailValidator\Validation\DNSGetRecordWrapper {
    public array $queries=[];
    public function __construct(private array $records,private array $failed){}
    public function getRecords(string $host,int $type):Egulias\EmailValidator\Validation\DNSRecords{
        $kind=$type===DNS_AAAA?'AAAA':'A+MX';$key=$host.'/'.$kind;$this->queries[]=$key;
        return new Egulias\EmailValidator\Validation\DNSRecords($this->records[$key]??[],in_array($key,$this->failed,true));
    }
}
$dnsCases=[
    ['name'=>'MX','value'=>'user@example.com','records'=>['example.com/A+MX'=>[['type'=>'MX','target'=>'mail.example.com.']]]],
    ['name'=>'A fallback','value'=>'user@example.com','records'=>['example.com/A+MX'=>[['type'=>'A']]]],
    ['name'=>'AAAA fallback','value'=>'user@example.com','records'=>['example.com/AAAA'=>[['type'=>'AAAA']]]],
    ['name'=>'null MX','value'=>'user@example.com','records'=>['example.com/A+MX'=>[['type'=>'A'],['type'=>'MX','target'=>'.']]]],
    ['name'=>'IDN UTS46','value'=>'user@bücher.de','records'=>['xn--bcher-kva.de/A+MX'=>[['type'=>'MX','target'=>'mx.de.']]]],
    ['name'=>'native ICU78 sharp s','value'=>'user@faß.de','records'=>['xn--fa-hia.de/A+MX'=>[['type'=>'A']]]],
    ['name'=>'parent first','value'=>'user@sub.example.com','records'=>['example.com/A+MX'=>[['type'=>'A']]]],
    ['name'=>'child after parent','value'=>'user@sub.example.com','records'=>['sub.example.com/A+MX'=>[['type'=>'A']]]],
    ['name'=>'A MX error','value'=>'user@example.com','records'=>['example.com/AAAA'=>[['type'=>'AAAA']]],'failed'=>['example.com/A+MX']],
    ['name'=>'AAAA error','value'=>'user@example.com','records'=>['example.com/A+MX'=>[['type'=>'MX','target'=>'mx.example.com.']]],'failed'=>['example.com/AAAA']],
    ['name'=>'reserved','value'=>'user@reserved.invalid','records'=>[]],
    ['name'=>'no implicit rfc','value'=>'a..b@example.com','records'=>['example.com/A+MX'=>[['type'=>'A']]]],
];
foreach($dnsCases as &$case){$wrapper=new ControlledEmailDNS($case['records'],$case['failed']??[]);$validation=new Egulias\EmailValidator\Validation\DNSCheckValidation($wrapper);$case['valid']=(new EmailValidator())->isValid($case['value'],$validation);$case['queries']=$wrapper->queries;$case['records']=(object)$case['records'];}unset($case);
echo json_encode(['meta'=>['php'=>PHP_VERSION,'intl'=>extension_loaded('intl'),'icu'=>defined('INTL_ICU_VERSION')?INTL_ICU_VERSION:null,'unicode'=>class_exists('IntlChar')?IntlChar::getUnicodeVersion():null,'spoofchecker'=>class_exists('Spoofchecker'),'idn_to_ascii'=>function_exists('idn_to_ascii'),'egulias'=>Composer\InstalledVersions::getPrettyVersion('egulias/email-validator'),'laravel'=>Composer\InstalledVersions::getPrettyVersion('laravel/framework')],'cases'=>$cases,'dns_cases'=>$dnsCases],JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
