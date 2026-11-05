"""Deterministic Python-reference vectors; no network, address detection or defaults."""
import ipaddress
import json
from pathlib import Path
import random
import sys

root = Path(__file__).resolve().parents[2]
source = json.loads((root / 'artifacts/game-parity-20261029/astroneer-native-setup-validation.json').read_text())
values = source['vectors']['accept'] + source['vectors']['reject']
values += ['1.1.1.1\n', ' 1.1.1.1', '1.1.1.1 ', '01.1.1.1', '1.1.1', '1.1.1.256', '+1.1.1.1', '::ffff:8.8.8.8', '1.1.1.1/32', '1.1.1.1\x00', '１.1.1.1']
for text in ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4']:
    block = ipaddress.IPv4Network(text)
    for number in [int(block.network_address)-1, int(block.network_address), int(block.broadcast_address), int(block.broadcast_address)+1]:
        if 0 <= number < 2**32: values.append(str(ipaddress.IPv4Address(number)))
values += [f'192.0.0.{n}' for n in range(256)]
rng = random.Random(20261029)
values += [str(ipaddress.IPv4Address(rng.randrange(2**32))) for _ in range(512)]
rows = []
for value in dict.fromkeys(values):
    try:
        address = ipaddress.IPv4Address(value)
        expected = address.is_global and not address.is_multicast
    except ValueError:
        expected = False
    rows.append({'value': value, 'accept': expected})
result = {'reference': 'Python IPv4Address.is_global and not is_multicast', 'python': sys.version.split()[0], 'source': 'https://docs.python.org/3/library/ipaddress.html#ipaddress.IPv4Address.is_global', 'vectors': rows}
(root / 'internal/panel/testdata/setup-public-ipv4-vectors.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
print(len(rows))
