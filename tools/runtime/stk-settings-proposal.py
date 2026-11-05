"""Read-only STK v6 settings adapter proposal. No generic backend registration.

Integration must add revision-checked stopped-server writes that patch only
validated value attribute spans, preserving comments and unknown XML verbatim.
CLI-owned name/mode/difficulty/slots/MOTD must use startup variables instead.
Never expose private-server-password in this public model.
"""
import xml.etree.ElementTree as ET

BOOLEANS = {'chat', 'track-voting', 'owner-less', 'auto-end', 'team-choosing'}
INTEGERS = {'voting-timeout': (1, 600), 'min-start-game-players': (1, 24)}


def parse(content):
    if len(content) > 1024 * 1024 or b'<!DOCTYPE' in content.upper() or b'<!ENTITY' in content.upper():
        raise ValueError('Unsafe or oversized STK XML')
    root = ET.fromstring(content)
    if root.tag != 'server-config' or root.attrib != {'version': '6'}:
        raise ValueError('Only reviewed STK server-config version 6 is supported')
    seen = set()
    result = {}
    for node in root:
        if node.tag not in BOOLEANS | INTEGERS.keys():
            continue
        if node.tag in seen or set(node.attrib) != {'value'} or len(node) or (node.text or '').strip():
            raise ValueError('Ambiguous STK setting')
        seen.add(node.tag)
        value = node.attrib['value']
        if node.tag in BOOLEANS:
            if value not in ('true', 'false'):
                raise ValueError('Invalid STK boolean')
            result[node.tag] = value == 'true'
        else:
            low, high = INTEGERS[node.tag]
            if not value.isascii() or not value.isdecimal() or not low <= int(value) <= high:
                raise ValueError('Invalid STK integer')
            result[node.tag] = int(value)
    return result
