package panel

import (
	"context"
	"strconv"
)

func wave43KF2Tuple(files map[string][]byte, env map[string]string, primary int, ports map[int]bool) error {
	query, e := strconv.Atoi(env["QUERY_PORT"])
	if e != nil {
		return notFound()
	}
	web, e := strconv.Atoi(env["WEB_ADMIN_PORT"])
	if e != nil {
		return notFound()
	}
	return validateKF2SettingsTuple(files[kf2SettingsGamePath], files[kf2SettingsWebPath], primary, query, web, ports)
}
func (a *App) wave43ValidateKF2Update(ctx context.Context, s M, file string, updated []byte) error {
	config, e := a.serverConfig(ctx, s)
	if e != nil {
		return e
	}
	env := map[string]string{}
	for k, v := range asMap(config["environment"]) {
		env[k] = str(v)
	}
	files := map[string][]byte{}
	for _, p := range []string{kf2SettingsGamePath, kf2SettingsWebPath} {
		data, exists, e := a.quickSetupRead(ctx, s, p)
		if e != nil {
			return e
		}
		if !exists {
			return notFound()
		}
		files[p] = data
	}
	files[file] = updated
	rows, e := a.query(ctx, "SELECT port FROM allocations WHERE server_id=$1", s["id"])
	if e != nil {
		return e
	}
	ports := map[int]bool{}
	for _, r := range rows {
		ports[int(num(r["port"]))] = true
	}
	return wave43KF2Tuple(files, env, int(num(asMap(asMap(config["allocations"])["default"])["port"])), ports)
}
