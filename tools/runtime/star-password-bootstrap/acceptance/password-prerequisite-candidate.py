"""MIT. Staged replacement function only; canonical adapter is unchanged.

Uses existing adapter globals confined/read_json. Current native uppercase proof:
.local/star-bound-acceptance/native-files-shape.json. Exact lowercase legacy
proof: reference published egg installer jq password keys (no case folding).
"""

def password_prerequisites(root, env):
    for key, filename in [('ADMIN_PASSWORD', 'Password.json'), ('PLAYER_PASSWORD', 'PlayerPassword.json')]:
        path = confined(root, filename)
        if env.get(key, '') and not path.is_file():
            raise ValueError('StarRupture native encrypted password file is required; automatic external password transmission is unavailable')
        if path.exists():
            value = read_json(path)
            if not isinstance(value, dict):
                raise ValueError('Native password file requires a supported encrypted password object')
            upper, lower = 'Password' in value, 'password' in value
            if upper == lower:
                raise ValueError('Native password file requires one exact supported encrypted password field')
            field = 'Password' if upper else 'password'
            if not isinstance(value[field], str) or not value[field]:
                raise ValueError('Native password file requires its publisher-compatible encrypted password value')
