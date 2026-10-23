#!/usr/bin/env python3
"""MIT. Development-only read probes using native challenge HMAC-MD4 RCON.

Uses the system OpenSSL MD4 primitive solely to interoperate with DarkPlaces.
No plaintext RCON fallback. Passwords come from the environment, never argv.
"""
import ctypes
import hmac
import json
import os
import socket
import sys


class MD4:
    digest_size, block_size, name = 16, 64, 'md4'
    library = ctypes.CDLL('libcrypto.so.3')
    primitive = library.MD4
    primitive.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p]
    primitive.restype = ctypes.c_void_p

    def __init__(self, data=b''):
        self.data = data

    def update(self, data):
        self.data += data

    def digest(self):
        result = ctypes.create_string_buffer(16)
        if not self.primitive(self.data, len(self.data), result):
            raise ValueError('System OpenSSL MD4 failed')
        return result.raw

    def copy(self):
        return MD4(self.data)


def query(host, port, password, command):
    if command not in ('status', 'sv_public', 'rcon_secure', 'g_gametype', 'g_tdm', 'fraglimit', 'timelimit', 'voltra_acceptance_marker', 'hostname', 'minplayers'):
        raise ValueError('Only reviewed read commands are accepted')
    if MD4(b'abc').digest().hex() != 'a448017aaf21d8525fc10ae87aa6729d':
        raise ValueError('System MD4 known-vector check failed')
    address = (socket.gethostbyname(host), port)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as channel:
        channel.settimeout(3)
        channel.connect(address)
        channel.send(b'\xff\xff\xff\xffgetchallenge')
        challenge = channel.recv(8192)
        if not challenge.startswith(b'\xff\xff\xff\xffchallenge '):
            raise ValueError('Native server challenge missing')
        token = challenge[14:].split(b'\x00', 1)[0]
        message = token + b' ' + command.encode('ascii')
        digest = hmac.new(password.encode('utf-8'), message, MD4).digest()
        channel.send(b'\xff\xff\xff\xffsrcon HMAC-MD4 CHALLENGE ' + digest + b' ' + message)
        packets = []
        try:
            while True:
                packet = channel.recv(65535)
                if packet.startswith(b'\xff\xff\xff\xffn'):
                    packets.append(packet[5:].decode('utf-8', errors='replace').rstrip('\x00'))
                elif packet.startswith(b'\xff\xff\xff\xffprint\n'):
                    packets.append(packet[10:].decode('utf-8', errors='replace').rstrip('\x00'))
                channel.settimeout(0.3)
        except socket.timeout:
            pass
        response = ''.join(packets)
        # Empty and native rejection replies never count as authenticated.
        authenticated = bool(response) and not any(x in response.lower() for x in ['bad rcon', 'invalid password', 'denied'])
        return {'command': command, 'authenticated': authenticated, 'response': response if authenticated else ''}


if __name__ == '__main__':
    host, port, command = sys.argv[1:]
    print(json.dumps(query(host, int(port), os.environ['DARKPLACES_RCON_PASSWORD'], command)))
