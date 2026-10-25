#!/bin/bash
# Adapted from factoriotools/factorio-docker a2ea39d069563c3c61c837889e7e569fb95486ef.
# MIT license: FACTORIOTOOLS-LICENSE. Voltra changes use staged files, literal
# environment credentials, strict Factorio branches and required dependencies.
set -eou pipefail

FACTORIO_VERSION=$1
MOD_DIR=$2
INSTALL_ROOT="${MOD_DIR%/*}"
USERNAME=${SERVER_USERNAME:-}
TOKEN=${SERVER_TOKEN:-}
UPDATE_IGNORE=${MOD_UPDATE_IGNORE:-}
declare -A VISITED SELECTED CONFLICTS
COUNT=0

MOD_BASE_URL="https://mods.factorio.com"

# Recycler became a publisher builtin in 2.1. Its name alone is not proof
# that this installed game provides it. Never send it to the mod portal.
validate_recycler_builtin() {
  local info="$INSTALL_ROOT/data/recycler/info.json"
  [[ $(check_dependency_version 'recycler >= 2.1.0' "$FACTORIO_VERSION") == 1 ]] &&
    [[ -f "$info" && ! -L "$info" ]] &&
    jq -e --arg version "$FACTORIO_VERSION" --arg branch "${FACTORIO_VERSION%.*}" '.name == "recycler" and .version == $version and .factorio_version == $branch' "$info" >/dev/null || {
      print_failure 'Recycler requires the matching publisher builtin from Factorio 2.1 or newer; installed mods preserved.'
      return 1
    }
}

print_step()
{
  echo "$1"
}

print_success()
{
  echo "$1"
}

print_failure()
{
  echo "$1"
}

# Checks if the current game version satisfies the mod's minimum required version.
# Returns 1 if the game version is compatible with the mod, 0 if not
check_game_version() {
  local mod_required_version="$1"  # The minimum Factorio version required by the mod
  local current_game_version="$2"  # The current Factorio version

  local mod_major mod_minor game_major game_minor
  mod_major=$(echo "$mod_required_version" | cut -d '.' -f1)
  mod_minor=$(echo "$mod_required_version" | cut -d '.' -f2)
  game_major=$(echo "$current_game_version" | cut -d '.' -f1)
  game_minor=$(echo "$current_game_version" | cut -d '.' -f2)

  if [[ "$game_major.$game_minor" == "$mod_major.$mod_minor" ]]; then echo 1; else echo 0; fi
}

# Checks dependency string with provided version.
# Only checks for operator based string, ignoring everything else
# Returns 1 if check is ok, 0 if not
check_dependency_version()
{
  local dependency="$1"
  local mod_version="$2"

  if [[ "$dependency" =~ ^(\?|!|~|\(~\)) ]]; then
    echo 1
    return
  fi

  local condition
  condition=$(echo "$dependency" | grep -oE '(>=|<=|>|<|=) [0-9]+(\.[0-9]+)*' || true)

  if [[ -z "$condition" ]]; then
    echo 1
    return
  fi

  local operator required_version
  operator=$(echo "$condition" | awk '{print $1}')
  required_version=$(echo "$condition" | awk '{print $2}')

  case "$operator" in
    ">=")
      if [[ "$(printf '%s\n%s\n' "$required_version" "$mod_version" | sort -V | head -n1)" == "$required_version" ]]; then
        echo 1
      else
        echo 0
      fi
      ;;
    ">")
      if [[ "$(printf '%s\n%s\n' "$required_version" "$mod_version" | sort -V | head -n1)" == "$required_version" && "$required_version" != "$mod_version" ]]; then
        echo 1
      else
        echo 0
      fi
      ;;
    "<=")
      if [[ "$(printf '%s\n%s\n' "$required_version" "$mod_version" | sort -V | tail -n1)" == "$required_version" ]]; then
        echo 1
      else
        echo 0
      fi
      ;;
    "<")
      if [[ "$(printf '%s\n%s\n' "$required_version" "$mod_version" | sort -V | tail -n1)" == "$required_version" && "$required_version" != "$mod_version" ]]; then
        echo 1
      else
        echo 0
      fi
      ;;
    "=")
      if [[ "$mod_version" == "$required_version" ]]; then
        echo 1
      else
        echo 0
      fi
      ;;
    *)
      echo 0
      ;;
  esac
}

get_mod_info()
{
  local mod_info_json="$1"

  # Process mod releases from newest to oldest, looking for a compatible version
  while IFS= read -r mod_release_info; do
    local mod_version mod_factorio_version
    mod_version=$(echo "$mod_release_info" | jq -r ".version")
    mod_factorio_version=$(echo "$mod_release_info" | jq -r ".info_json.factorio_version")

    # Check if this mod version is compatible with our Factorio version
    # This prevents downloading mods that require a newer Factorio version (fixes #468)
    # and ensures backward compatibility (e.g., Factorio 2.0 can use 1.x mods) (fixes #517)
    if [[ $(check_game_version "$mod_factorio_version" "$FACTORIO_VERSION") == 0 ]]; then
      echo "  Skipping mod version $mod_version because of factorio version mismatch"  >&2
      continue
    fi

    if [[ -n "${REQUIRED_CONSTRAINT:-}" ]] && [[ $(check_dependency_version "$REQUIRED_CONSTRAINT" "$mod_version") != 1 ]]; then continue; fi
    # If we found 'dependencies' element, we also check versions there
    if [[ $(echo "$mod_release_info" | jq -e '.info_json | has("dependencies") and (.dependencies | length > 0)') == true ]]; then
      while IFS= read -r dependency; do

        # We only check for 'base' dependency
        if [[ "$dependency" == base* ]] && [[ $(check_dependency_version "$dependency" "$FACTORIO_VERSION") == 0 ]]; then
          echo "  Skipping mod version $mod_version, unsatisfied base dependency: $dependency" >&2
          continue 2
        fi

      done < <(echo "$mod_release_info" | jq -r '.info_json.dependencies[]')
    fi

    echo "$mod_release_info" | jq -j ".file_name, \";\", .download_url, \";\", .sha1"
    break

  done < <(echo "$mod_info_json" | jq -c ".releases|sort_by(.released_at)|reverse|.[]")
}

# Check if a mod should be ignored based on UPDATE_IGNORE environment variable
is_mod_ignored() {
  local mod_name="$1"
  
  # If UPDATE_IGNORE is not set or empty, don't ignore any mods
  if [[ -z "${UPDATE_IGNORE:-}" ]]; then
    return 1
  fi
  
  # Split the comma-separated list and check if mod_name is in it
  IFS=',' read -ra ignored_mods <<< "$UPDATE_IGNORE"
  for ignored_mod in "${ignored_mods[@]}"; do
    # Trim whitespace from ignored_mod
    ignored_mod=$(echo "$ignored_mod" | xargs)
    if [[ "$mod_name" == "$ignored_mod" ]]; then
      return 0
    fi
  done
  
  return 1
}

update_mod()
{
  local MOD_NAME MOD_NAME_ENCODED MOD_INFO_URL MOD_INFO_JSON MOD_INFO MOD_FILENAME MOD_URL MOD_SHA1 HTTP_STATUS FULL_URL file
  local REQUIRED_CONSTRAINT="${2:-}" dependency dep_name dep_version selected_version
  MOD_NAME="$1"
  [[ "$MOD_NAME" =~ ^[A-Za-z0-9_-]+$ ]] || { print_failure 'Invalid mod name.'; return 1; }
  if is_mod_ignored "$MOD_NAME"; then
    local installed
    installed=$(printf '%s\n' "$MOD_DIR/${MOD_NAME}_"*.zip | sed -n "s|^.*/${MOD_NAME}_\\([0-9.]*\\)\\.zip$|\\1|p" | sort -V | tail -n1)
    [[ -n "$installed" && $(check_dependency_version "$REQUIRED_CONSTRAINT" "$installed") == 1 ]] || { print_failure "Pinned mod cannot satisfy dependency: $MOD_NAME"; return 1; }
    return 0
  fi
  if [[ -n "${VISITED[$MOD_NAME]:-}" ]]; then
    [[ $(check_dependency_version "$REQUIRED_CONSTRAINT" "${SELECTED[$MOD_NAME]}") == 1 ]] || { print_failure "Conflicting dependency: $MOD_NAME"; return 1; }
    return 0
  fi
  COUNT=$((COUNT+1)); [[ "$COUNT" -le 500 ]] || { print_failure 'Dependency limit exceeded.'; return 1; }
  MOD_NAME_ENCODED="${1// /%20}"

  print_step "Checking for update of mod $MOD_NAME for factorio $FACTORIO_VERSION ..."

  MOD_INFO_URL="$MOD_BASE_URL/api/mods/$MOD_NAME_ENCODED/full"
  MOD_INFO_JSON=$(curl --fail --silent --show-error --connect-timeout 20 --max-time 120 "$MOD_INFO_URL") || return 1

  if ! echo "$MOD_INFO_JSON" | jq -e --arg name "$MOD_NAME" '.name == $name and (.releases | type == "array")' >/dev/null; then
    print_failure "Metadata unavailable for $MOD_NAME; installed mods preserved."
    return 1
  fi

  MOD_INFO=$(get_mod_info "$MOD_INFO_JSON")

  if [[ "$MOD_INFO" == "" ]]; then
    print_failure "  No compatible release or dependency version."
    return 1
  fi

  MOD_FILENAME=$(echo "$MOD_INFO" | cut -f1 -d";")
  MOD_URL=$(echo "$MOD_INFO" | cut -f2 -d";")
  MOD_SHA1=$(echo "$MOD_INFO" | cut -f3 -d";")

  if [[ $MOD_FILENAME == null ]]; then
    print_failure "  No compatible release."
    return 1
  fi

  [[ "$MOD_FILENAME" =~ ^[A-Za-z0-9_-]+_[0-9]+\.[0-9]+\.[0-9]+\.zip$ ]] && [[ "$MOD_URL" == /download/* ]] && [[ "$MOD_URL" != *'?'* ]] && [[ "$MOD_URL" != *'..'* ]] && [[ "$MOD_SHA1" =~ ^[0-9a-f]{40}$ ]] || { print_failure 'Invalid release metadata.'; return 1; }
  selected_version=$(echo "$MOD_INFO_JSON" | jq -r --arg f "$MOD_FILENAME" '.releases[] | select(.file_name == $f) | .version')
  VISITED[$MOD_NAME]=1; SELECTED[$MOD_NAME]="$selected_version"
  while IFS= read -r dependency; do
    if [[ "$dependency" == '! '* ]]; then
      dep_name="${dependency#'! '}"; dep_name="${dep_name%% *}"
      CONFLICTS["$MOD_NAME|$dep_name"]=1
      if jq -e --arg name "$dep_name" 'any(.mods[]; .name == $name and .enabled)' "$MOD_DIR/mod-list.json" >/dev/null; then print_failure "Incompatible enabled mod: $dep_name"; return 1; fi
      continue
    fi
    if [[ "$dependency" == '? '* || "$dependency" == '(?) '* ]]; then
      dependency="${dependency#* }"; dep_name="${dependency%% *}"
      jq -e --arg name "$dep_name" 'any(.mods[]; .name == $name and .enabled)' "$MOD_DIR/mod-list.json" >/dev/null || continue
    fi
    dependency="${dependency#~ }"
    if [[ "$dependency" =~ ^([A-Za-z0-9_-]+)([[:space:]]+((\>=|\<=|\>|\<|=)[[:space:]]+[0-9]+(\.[0-9]+)*))?$ ]]; then dep_name="${BASH_REMATCH[1]}"; else print_failure 'Invalid dependency metadata.'; return 1; fi
    case "$dep_name" in
      base|space-age|quality|elevated-rails|recycler)
        if [[ "$dep_name" == recycler ]]; then validate_recycler_builtin || return 1; fi
        [[ $(check_dependency_version "$dependency" "$FACTORIO_VERSION") == 1 ]] || { print_failure 'Builtin dependency version cannot be satisfied.'; return 1; } ;;
      *) update_mod "$dep_name" "$dependency" || return 1 ;;
    esac
    jq --arg name "$dep_name" 'if any(.mods[]; .name == $name) then .mods |= map(if .name == $name then .enabled=true else . end) else .mods += [{name:$name,enabled:true}] end' "$MOD_DIR/mod-list.json" > "$MOD_DIR/.mod-list.tmp" || return 1
    mv "$MOD_DIR/.mod-list.tmp" "$MOD_DIR/mod-list.json" || return 1
  done < <(echo "$MOD_INFO_JSON" | jq -r --arg f "$MOD_FILENAME" '.releases[] | select(.file_name == $f) | .info_json.dependencies[]?')
  if [[ -f $MOD_DIR/$MOD_FILENAME ]] && [[ $(sha1sum "$MOD_DIR/$MOD_FILENAME" | cut -d ' ' -f1) == "$MOD_SHA1" ]]; then
    print_success "  Already up-to-date."
    return 0
  fi

  print_step "  Downloading $MOD_FILENAME"
  [[ -n "$USERNAME" && -n "$TOKEN" ]] || { print_failure 'Mod downloads require a Factorio username and token.'; return 1; }
  # Credentials are supplied through curl config stdin, never process arguments.
  FULL_URL="$MOD_BASE_URL$MOD_URL"
  local download; download=$(mktemp "$MOD_DIR/.download.XXXXXX")
  local encoded_user encoded_token
  encoded_user=$(jq -rn 'env.SERVER_USERNAME | @uri') || return 1
  encoded_token=$(jq -rn 'env.SERVER_TOKEN | @uri') || return 1
  HTTP_STATUS=$(printf 'url = "%s?username=%s&token=%s"\n' "$FULL_URL" "$encoded_user" "$encoded_token" | curl --config - --get --silent --connect-timeout 20 --max-time 300 -L -w "%{http_code}" -o "$download") || { rm -f "$download"; return 1; }
  if [[ $HTTP_STATUS == 200 ]] && [[ $(sha1sum "$download" | cut -d ' ' -f1) == "$MOD_SHA1" ]]; then mv "$download" "$MOD_DIR/$MOD_FILENAME"; else rm -f "$download"; print_failure 'Mod download failed or checksum did not match; installed mods preserved.'; return 1; fi

  if [[ $HTTP_STATUS != 200 ]]; then
    print_failure "  Download failed: Code $HTTP_STATUS."
    rm -f "$MOD_DIR/$MOD_FILENAME"
    return 1
  fi

  if [[ ! -f $MOD_DIR/$MOD_FILENAME ]]; then
    print_failure "  Downloaded file missing!"
    return 1
  fi

  if ! [[ $(sha1sum "$MOD_DIR/$MOD_FILENAME") =~ $MOD_SHA1 ]]; then
    print_failure "  SHA1 mismatch!"
    rm -f "$MOD_DIR/$MOD_FILENAME"
    return 1
  fi

  print_success "  Download complete."

  for file in "$MOD_DIR/${MOD_NAME}_"*".zip"; do # wildcard does usually not work in quotes: https://unix.stackexchange.com/a/67761
    if [[ $file != $MOD_DIR/$MOD_FILENAME ]]; then
      print_success "  Deleting old version: $file"
      rm -f "$file"
    fi
  done

  return 0
}

# Entire-set staging keeps old versions intact on network/auth/hash failure.
[[ ! -L "$MOD_DIR" ]] || { print_failure 'Mod directory must not be a symlink.'; exit 1; }
ORIGINAL_MOD_DIR="$MOD_DIR"
STAGE=$(mktemp -d "${MOD_DIR%/*}/.mod-update.XXXXXX")
trap 'if [[ ! -d "$ORIGINAL_MOD_DIR" && -n "${BACKUP:-}" && -d "$BACKUP" ]]; then mv "$BACKUP" "$ORIGINAL_MOD_DIR"; fi; rm -rf -- "$STAGE"' EXIT
cp -a "$MOD_DIR/." "$STAGE/"
MOD_DIR="$STAGE"
# Process all enabled mods from mod-list.json, but skip built-in mods
# The Space Age DLC includes built-in mods (elevated-rails, quality, space-age) that should not be downloaded
if [[ -f $MOD_DIR/mod-list.json ]]; then
  jq -r ".mods|map(select(.enabled))|.[].name" "$MOD_DIR/mod-list.json" | { while read -r mod; do
    # Skip base mod and DLC built-in mods
    if [[ $mod == recycler ]]; then validate_recycler_builtin || exit 1; fi
    if [[ $mod != base ]] && [[ $mod != elevated-rails ]] && [[ $mod != quality ]] && [[ $mod != space-age ]] && [[ $mod != recycler ]]; then
      if is_mod_ignored "$mod"; then
        print_success "Skipping mod $mod (listed in UPDATE_IGNORE)"
      else
        update_mod "$mod" || exit 1
      fi
    fi
  done
  for pair in "${!CONFLICTS[@]}"; do
    left="${pair%%|*}"; right="${pair#*|}"
    if jq -e --arg a "$left" --arg b "$right" 'any(.mods[]; .name == $a and .enabled) and any(.mods[]; .name == $b and .enabled)' "$MOD_DIR/mod-list.json" >/dev/null; then print_failure 'Conflicting mods in resolved set.'; exit 1; fi
  done; }
fi

BACKUP="${ORIGINAL_MOD_DIR%/*}/.voltra/mod-backups/$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "${BACKUP%/*}"
mv "$ORIGINAL_MOD_DIR" "$BACKUP"
if ! mv "$STAGE" "$ORIGINAL_MOD_DIR"; then mv "$BACKUP" "$ORIGINAL_MOD_DIR"; exit 1; fi
echo 'Mod update complete; previous mod set retained in .voltra/mod-backups.'
