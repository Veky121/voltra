"""Read-only real dynamic-loader symbol-version check, no database connection."""
import ctypes
import hashlib
import json
from pathlib import Path
import os
source=Path('/compat/libmariadb.so.3')
plugin=json.loads(Path('/evidence/first-native-diagnostic.json').read_text())['plugin']
library=ctypes.CDLL(str(source),mode=os.RTLD_NOW|os.RTLD_LOCAL)
loader=ctypes.CDLL(None);lookup=loader.dlvsym;lookup.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_char_p];lookup.restype=ctypes.c_void_p
required=plugin['imported_sql_symbols'];results={name:bool(lookup(library._handle,name.encode(),b'libmysqlclient_18')) for name in required}
assert len(results)==27 and all(results.values()),'Exact required versioned SQL imports do not resolve'
print(json.dumps({'library_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'required_plugin_sha256':plugin['sha256'],'required_version':'libmysqlclient_18','exact_import_count':len(results),'versioned_symbols':results,'dynamic_loader_rtld_now':True}))
