# Game settings fixtures

These are the config examples and frozen installer outputs used by the parser and
settings-authority tests. Tests read them directly from this checkout; they do not
require a developer's ignored `artifacts/` or `.local/` directories.

Profile JSON is reduced to fields consumed by the tests where possible. Config
passwords are empty or fixture placeholders. Frozen helper bytes remain unchanged
where tests verify an exact digest. These files exercise serialization and helper
validation; they do not establish native gameplay, installation, or save retention.

Historical campaign receipt checks use the `campaign_audit` build tag. The
Valheim Plus API test requiring a retained game/plugin archive uses
`native_fixtures`. Those checks still require their original external inputs and
are not represented as successful by the ordinary CI suite.
