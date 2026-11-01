"""MIT. Strict, bounded Puck compatibility readiness observer."""
import json
import math
import re


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('Duplicate Puck proof key')
        result[key] = value
    return result


class PuckObserver:
    limit = 1024 * 1024

    def __init__(self, env):
        self.expected = {key: int(env[name]) for key, name in [
            ('serverPhysicsTick', 'SERVER_TICK_RATE'),
            ('advertisedClientInputTick', 'CLIENT_TICK_RATE'),
            ('engineTargetFrameRate', 'FRAME_RATE'),
            ('configuredKickTimeout', 'KICK_TIMEOUT'),
            ('nativeQueryPort', 'QUERY_PORT')]}
        self.pending = b''
        self.ready = False
        self.proof = None
        self.emitted = False

    def __call__(self, block):
        # Bound each line, not the total size of a batch of complete lines.
        for part in block.splitlines(keepends=True):
            self.pending += part
            if len(self.pending) > self.limit:
                raise ValueError('Puck native output line exceeds observer bound')
            if self.pending.endswith(b'\n'):
                line, self.pending = self.pending, b''
                self.line(line)

    def line(self, line):
        line = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', line)
        if (b'Failed to enable plugin VoltraLegacyControls' in line or
                b'[VoltraLegacyControls] Compatibility initialization failed:' in line):
            raise ValueError('Puck compatibility plugin failed')
        marker = b'[VoltraLegacyControls] Native proof '
        if marker in line:
            def invalid(_):
                raise ValueError('Non-finite Puck proof')
            proof = json.loads(line.split(marker, 1)[1], object_pairs_hook=pairs,
                               parse_constant=invalid)
            if not isinstance(proof, dict):
                raise ValueError('Puck proof must be an object')
            duration = proof.get('probedNativeKickTweenSeconds')
            if (any(type(proof.get(k)) is not int or proof[k] != v
                    for k, v in self.expected.items()) or
                    proof.get('nativeQueryListening') is not True or
                    proof.get('failure') is not None or
                    type(duration) not in (int, float) or
                    not math.isfinite(duration) or
                    abs(duration - self.expected['configuredKickTimeout']) > .01):
                raise ValueError('Puck native control proof differs from requested controls')
            self.proof = proof
        if b'is ready to accept clients on' in line:
            self.ready = True
        if self.proof and self.ready and not self.emitted:
            print('Voltra Puck compatibility ready', flush=True)
            self.emitted = True
