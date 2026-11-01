"""NOTD scalar INI edits; unknown Unreal operators and comments stay byte exact."""
import re

def patch(content, sections):
    newline = '\r\n' if '\r\n' in content else '\n'
    identities = {s.casefold(): s for s in sections}
    seen_sections, seen_keys, result = set(), set(), []
    active = None
    def append(row):
        if result and not result[-1].endswith(('\r', '\n')):
            result[-1] += newline
        result.append(row)
    def missing():
        for key, value in sections.get(active, {}).items():
            if (active, key) not in seen_keys:
                append(key + '=' + value + newline)
                seen_keys.add((active, key))
    for row in content.splitlines(keepends=True):
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', row.strip())
        if header:
            missing()
            active = identities.get(header[1].casefold())
            if active:
                if active in seen_sections:
                    raise ValueError('Duplicate managed NOTD section')
                seen_sections.add(active)
        elif active and '=' in row and not row.lstrip().startswith((';', '#', '//')):
            left, right = row.split('=', 1)
            key = next((k for k in sections[active] if k.casefold() == left.strip().casefold()), None)
            if key:
                if (active, key) in seen_keys:
                    raise ValueError('Duplicate managed NOTD key')
                seen_keys.add((active, key))
                # Only whitespace-separated native inline comments are comments.
                comment = re.search(r'\s+(?://|;|#).*', right.rstrip('\r\n'))
                suffix = comment[0] if comment else ''
                ending = '\r\n' if row.endswith('\r\n') else '\n' if row.endswith('\n') else ''
                row = left + '=' + sections[active][key] + suffix + ending
        append(row)
    missing()
    for section in sections:
        if section not in seen_sections:
            active = section
            append('[' + section + ']' + newline)
            missing()
    return ''.join(result)
