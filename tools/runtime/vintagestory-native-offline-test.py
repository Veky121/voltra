from pathlib import Path
root=Path(__file__).resolve().parents[2]
INSTALL_SOURCE=(root/'internal/panel/game_library/scripts/vintage-story-install.py').read_text(encoding='utf-8')
RUNTIME_SOURCE=(root/'internal/panel/game_library/scripts/vintage-story-runtime.py').read_text(encoding='utf-8')
script=root/'tools/runtime/test-vintage-story.py'
exec(compile(script.read_text(encoding='utf-8'),str(script),'exec'),globals())
