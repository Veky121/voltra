#!/bin/bash
# Silent installation of FS25 + DLCs under Wine, plus the one-time CD-key step.
#
# Expects (exported by start.sh): WINEPREFIX, GAME_DIR, DOCS_DIR, INSTALLER_DIR,
# DLC_DIR, FS25_CONFIG. With --dlc-only it skips the base game install and only
# processes newly uploaded DLCs.
#
# POLICY: This script runs the unmodified GIANTS installer and its online
# activation. It must NEVER patch binaries, block/redirect GIANTS activation
# servers, fake license files, or otherwise weaken copy protection. The serial
# is supplied by the operator and validated by GIANTS online — keep it that way.
set -uo pipefail
umask 077

# Running this against a live session would replace files the game is using.
if pgrep -x 'FarmingSimulato|dedicatedServer' >/dev/null 2>&1; then
    echo '[fs25/install] Refusing installation while FS25 is running.' >&2
    exit 1
fi

DLC_ONLY=0
[ "${1:-}" = "--dlc-only" ] && DLC_ONLY=1

DLC_PREFIX="FarmingSimulator25_"

log()  { echo -e "\e[36m[fs25/install]\e[0m $*"; }
warn() { echo -e "\e[33m[fs25/install] WARN:\e[0m $*"; }
err()  { echo -e "\e[31m[fs25/install] ERROR:\e[0m $*"; }

# ---- Locate / extract the base installer -------------------------------------
find_installer() {
    if [ -f "${INSTALLER_DIR}/FarmingSimulator2025.exe" ]; then
        echo "${INSTALLER_DIR}/FarmingSimulator2025.exe"; return 0
    fi
    if [ -f "${INSTALLER_DIR}/Setup.exe" ]; then
        echo "${INSTALLER_DIR}/Setup.exe"; return 0
    fi
    # Try to extract a distribution image (.img / .zip) once.
    local img
    img=$(ls "${INSTALLER_DIR}"/FarmingSimulator25_*_ESD.img \
             "${INSTALLER_DIR}"/FarmingSimulator25_*.zip 2>/dev/null | head -n1)
    if [ -n "$img" ]; then
        # Note: logs go to stderr so they don't pollute the path on stdout that
        # the caller captures via installer="$(find_installer)".
        log "Extracting ${img##*/}..." >&2
        7z x "$img" -o"${INSTALLER_DIR}" -y -bso0 -bsp0 >&2 || return 1
        # The image is fully extracted now; drop it to reclaim ~21 GB (and lower
        # peak disk during install). Re-download happens automatically if needed.
        case "${KEEP_INSTALLER:-false}" in 1|true|yes|on) : ;; *) rm -f "$img" >&2 || true ;; esac
        [ -f "${INSTALLER_DIR}/FarmingSimulator2025.exe" ] && { echo "${INSTALLER_DIR}/FarmingSimulator2025.exe"; return 0; }
        [ -f "${INSTALLER_DIR}/Setup.exe" ] && { echo "${INSTALLER_DIR}/Setup.exe"; return 0; }
    fi
    return 1
}

# Remove installer artifacts once the game is installed. The *_ESD.img plus the
# extracted Setup-*.bin files are ~40+ GB and serve no purpose post-install.
cleanup_installer() {
    case "${KEEP_INSTALLER:-false}" in
        1|true|yes|on) log "KEEP_INSTALLER set — keeping installer files."; return 0 ;;
    esac
    log "Cleaning up installer files to reclaim disk space..."
    rm -f "${INSTALLER_DIR}"/*.img \
          "${INSTALLER_DIR}"/*.zip \
          "${INSTALLER_DIR}"/Setup-*.bin \
          "${INSTALLER_DIR}"/Setup.exe \
          "${INSTALLER_DIR}"/autorun.inf \
          "${INSTALLER_DIR}"/FarmingSimulator2025.exe 2>/dev/null || true
}

# ---- One-time CD-key / activation --------------------------------------------
# The base installer is fully silent, but the very first launch of the game
# requires a CD-key to be entered, which generates the *.dat license files.
# There is no documented CLI for this, so we drive the dialog with xdotool.
# This is best-effort and may need tuning against the real dialog layout.
activate_license() {
    if ls "${DOCS_DIR}"/*.dat >/dev/null 2>&1; then
        log "License files already present, skipping activation."
        return 0
    fi
    if [ -z "${GAME_SERIAL:-}" ]; then
        err "No license (*.dat) files and GAME_SERIAL is empty."
        err "Set the GAME_SERIAL variable to your FS25 key, or perform a one-time"
        err "manual activation and upload the generated *.dat files into:"
        err "  ${DOCS_DIR}/"
        return 1
    fi

    log "Activating with provided CD-key via xdotool..."
    # The launcher shows the "Please enter your Farming Simulator 25 Product Key"
    # dialog; the input field is auto-focused. Coordinates below are for the fixed
    # 1280x720 Xvfb that start.sh creates. The field auto-formats into 5-char
    # groups and ignores typed dashes, so we strip them before typing.
    local serial_clean
    serial_clean=$(printf '%s' "${GAME_SERIAL}" | tr -d '[:space:]-')

    wine "${GAME_DIR}/FarmingSimulator2025.exe" >/tmp/fs25-activate.log 2>&1 &
    local game_pid=$!
    sleep 30  # give the activation dialog time to render

    # Focus + clear the field, type the key, click the "Activate >" button.
    xdotool mousemove 746 361 click 1; sleep 0.5
    xdotool key --clearmodifiers End; xdotool key --clearmodifiers --repeat 64 BackSpace; sleep 0.5
    printf '%s' "$serial_clean" | xdotool type --clearmodifiers --delay 100 --file -; sleep 1.5
    xdotool mousemove 875 536 click 1   # "Activate >"

    # The .dat license files appear within a few seconds of a successful activation.
    local ok=0
    for _ in $(seq 1 12); do
        sleep 5
        if ls "${DOCS_DIR}"/*.dat >/dev/null 2>&1; then ok=1; break; fi
    done

    # After activation the launcher tries to start the 3D game and shows a GPU
    # warning ("Could not init 3D system" -> Yes/No). Dismiss it with "No", then stop.
    xdotool mousemove 675 435 click 1 2>/dev/null || true; sleep 2
    wineserver -k >/dev/null 2>&1 || true
    kill "$game_pid" >/dev/null 2>&1 || true
    sleep 3

    if [ "$ok" -eq 1 ]; then
        log "Activation succeeded — license files generated."
        return 0
    fi
    err "Activation did not produce license files. The CD-key automation may need"
    err "adjusting for this game version. See ACTIVATION.md for the manual path."
    return 1
}

# ---- DLC installation ---------------------------------------------------------
# Each product is installed once, using its highest downloaded version. The
# previous payload is moved aside atomically and retained until game validation.
# This also avoids the overwrite prompt that the old fixed-click loop missed.
DLC_TIMEOUT="${DLC_TIMEOUT:-900}"
[[ "$DLC_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || { err "DLC_TIMEOUT must be positive seconds."; exit 1; }

install_one_dlc() (
    local dlc="$1" name="$2" hash="$3" serial_clean pid="" finished=0 elapsed=0 exit_code=0
    local entered=0 last_progress=-15 last_click=0 start bytes
    serial_clean=$(node "${FS25_LIB}/dlc-licences.mjs" "$dlc") || return 1
    node "${FS25_LIB}/dlc-update.mjs" begin "$dlc" || return 1

    cleanup_dlc() {
        if [ -n "$pid" ]; then
            # Only this installer's Windows image and isolated Unix process group.
            # Never use wineserver -k: it kills every game in the Wine prefix.
            timeout 10s wine taskkill /IM "${dlc##*/}" /T /F >/dev/null 2>&1 || true
            kill -TERM -- "-$pid" 2>/dev/null || true
            sleep 1
            kill -KILL -- "-$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
        if [ "$finished" -ne 1 ]; then
            node "${FS25_LIB}/dlc-update.mjs" rollback "$dlc" || return 1
            warn "${name}: update failed; previous payload restored if present."
        fi
    }
    trap cleanup_dlc EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM

    log "${name}: launching ${dlc##*/}; previous payload held for rollback."
    setsid wine "$dlc" >"/tmp/fs25-dlc-${name}.log" 2>&1 &
    pid=$!; start=$SECONDS
    while kill -0 "$pid" 2>/dev/null; do
        sleep 3
        elapsed=$((SECONDS-start))
        kill -0 "$pid" 2>/dev/null || break
        # Wine windows do not always expose the Unix launcher PID. Match the
        # known activation title throughout the run, including late dialogs.
        if [ "$entered" -eq 0 ] && [ "$elapsed" -ge 12 ]; then
            local key_window
            key_window=$(xdotool search --onlyvisible --name '^FarmingSimulator2025$' 2>/dev/null | head -n1 || true)
            if [ -n "$key_window" ]; then
                log "${name}: activation dialog detected; submitting assigned GIANTS key."
                xdotool windowfocus --sync "$key_window" || return 1
                xdotool mousemove 747 361 click 1 || return 1
                xdotool key --clearmodifiers End || return 1
                xdotool key --clearmodifiers --repeat 64 BackSpace || return 1
                printf '%s' "$serial_clean" | xdotool type --clearmodifiers --delay 100 --file - || return 1
                sleep 2
                xdotool mousemove 884 536 click 1 || return 1
                entered=1
            fi
        fi
        # Existing installer versions have an untitled success dialog at this
        # position. Do not send Enter or accept arbitrary update/error dialogs.
        if [ "$((elapsed-last_click))" -ge 6 ]; then
            xdotool mousemove 641 382 click 1 >/dev/null 2>&1 || true
            last_click=$elapsed
        fi
        if [ "$((elapsed-last_progress))" -ge 15 ]; then
            bytes=$(stat -c %s "${DOCS_DIR}/pdlc/${name}.dlc" 2>/dev/null || echo 0)
            log "${name}: installing, ${elapsed}s elapsed, payload ${bytes} bytes; total unknown."
            last_progress=$elapsed
        fi
        if [ "$elapsed" -ge "$DLC_TIMEOUT" ]; then
            # No raw window text/screenshots: activation dialogs can contain keys.
            printf 'reason=timeout\nelapsed_seconds=%s\nactivation_submitted=%s\npayload_bytes=%s\n' "$elapsed" "$entered" "$bytes" > "${DLC_DIR}/.last-failure-${name}.txt"
            warn "${name}: timed out after ${elapsed}s; activation submitted=${entered}; installer still running."
            warn "${name}: inspect the private installer log /tmp/fs25-dlc-${name}.log and Wine display before retrying."
            return 1
        fi
    done
    wait "$pid" || exit_code=$?
    pid=""
    log "${name}: installer exited with status ${exit_code} after ${elapsed}s; checking replacement payload."
    # GIANTS installers can return 1 under Wine. The game must still load the
    # exact requested version before the backup is removed or success is recorded.
    [ "$exit_code" -le 1 ] || return 1
    node "${FS25_LIB}/dlc-update.mjs" complete "$dlc" "$hash" || return 1
    finished=1
    log "${name}: payload staged; waiting for the game to validate the requested version."
)

install_dlcs() {
    mkdir -p "$DLC_DIR"
    local dlc base name hash failures=0 plan
    # flock survives subprocesses and releases automatically on process exit.
    exec 9>"${DLC_DIR}/.install.lock"
    flock -n 9 || { err "Another DLC installation is active. Retry when it finishes."; return 1; }
    plan=$(node "${FS25_LIB}/dlc-update.mjs" plan) || return 1
    while IFS= read -r base; do
        [ -n "$base" ] || continue
        dlc="${DLC_DIR}/${base}"
        name="${base#${DLC_PREFIX}}"; name="${name%%_*}"
        hash=$(sha256sum "$dlc" | cut -d' ' -f1) || return 1
        if node "${FS25_LIB}/dlc-update.mjs" valid "$dlc" "$hash"; then
            log "${name}: selected version already staged or verified; payload hash matches."
            continue
        fi
        log "Installing DLC: ${name} (${base})"
        install_one_dlc "$dlc" "$name" "$hash" || failures=$((failures+1))
    done <<< "$plan"
    exec 9>&-
    [ "$failures" -eq 0 ] || { warn "${failures} DLC update(s) failed; previous versions retained where available."; return 1; }
}

# ---- Base game install --------------------------------------------------------
if [ "${1:-}" = "--activate-only" ]; then
    activate_license
    exit $?
fi
if [ "$DLC_ONLY" -eq 0 ]; then
    installer="$(find_installer)" || {
        err "No installer found in ${INSTALLER_DIR}/."
        err "Upload FarmingSimulator2025.exe (or the *_ESD.img / .zip) there and restart."
        exit 1
    }
    log "Running silent install: ${installer##*/}"
    timeout --kill-after=30s 3600 wine "$installer" /SILENT /NOCANCEL /NOICONS /SUPPRESSMSGBOXES >/tmp/fs25-setup.log 2>&1 || {
        err "Silent install failed — see /tmp/fs25-setup.log"
        exit 1
    }
    [ -f "${GAME_DIR}/dedicatedServer.exe" ] || { err "dedicatedServer.exe missing after install."; exit 1; }
    log "Base game installed."

    activate_license || exit 1
    cleanup_installer
fi

[ "${1:-}" = "--base-only" ] || install_dlcs || exit 1
log "Install step complete; staged DLCs still require game validation."
