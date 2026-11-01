mindustry_validate_managed_paths() {
    local path
    for path in .voltra .voltra/classes .voltra/classes/mindustry .voltra/classes/mindustry/server; do
        if [ -L "$path" ] || { [ -e "$path" ] && [ ! -d "$path" ]; }; then
            echo 'Mindustry managed parent is linked or is not a directory; no acquisition or publication performed.' >&2
            return 2
        fi
    done
    for path in .voltra/VoltraMindustry.java .voltra/Mindustry-LICENSE .voltra/mindustry-native-start.sh .voltra/classes/mindustry/server/VoltraMindustry.class server-release.jar; do
        if [ -L "$path" ] || { [ -e "$path" ] && [ ! -f "$path" ]; }; then
            echo 'Mindustry managed target is linked or is not a regular file; no acquisition or publication performed.' >&2
            return 2
        fi
    done
}
