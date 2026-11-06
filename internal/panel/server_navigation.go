package panel

import (
	"net/http"
)

// Navigation preferences belong to the authenticated user, never the server owner.
func (a *App) registerServerNavigation(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/account/server-navigation", a.serverNavigationList)
	mux.HandleFunc("PUT /api/client/servers/{server}/navigation", a.serverNavigationFavorite)
	mux.HandleFunc("POST /api/client/servers/{server}/navigation", a.serverNavigationVisit)
}

func (a *App) serverNavigationList(w http.ResponseWriter, r *http.Request) {
	u, err := a.user(r)
	if err != nil {
		fail(w, err)
		return
	}
	entries, err := a.query(r.Context(), `SELECT s.uuid,s.uuid_short AS identifier,s.name,s.status,e.name AS egg_name,
 s.minecraft_pack,e.uuid AS artwork_egg_uuid,e.features AS artwork_egg_features,
 COALESCE(p.favorite,false) AS favorite,p.last_visited_at
 FROM servers s LEFT JOIN eggs e ON e.id=s.egg_id LEFT JOIN user_server_navigation p ON p.server_id=s.id AND p.user_id=$1
 WHERE $2 OR s.owner_id=$1 OR EXISTS(SELECT 1 FROM subusers su WHERE su.server_id=s.id AND su.user_id=$1)
 ORDER BY s.name,s.id`, u["id"], boolean(u["root_admin"]))
	if err != nil {
		fail(w, err)
		return
	}
	for _, entry := range entries {
		entry["artwork"] = navigationArtwork(entry)
		delete(entry, "minecraft_pack")
		delete(entry, "artwork_egg_uuid")
		delete(entry, "artwork_egg_features")
	}
	writeJSON(w, 200, collection("server_navigation", entries))
}

// Navigation only needs pack identity, without reading server files or exposing provider URLs.
func navigationArtwork(server M) M {
	out := M{}
	egg := M{"uuid": server["artwork_egg_uuid"], "features": server["artwork_egg_features"]}
	if !serverArtworkMinecraftWorkload(server, egg) {
		return out
	}
	out["game"] = "minecraft"
	pack := asMap(server["minecraft_pack"])
	if str(pack["name"]) != "" {
		out["pack_name"] = pack["name"]
	}
	if mcContentIcon(str(pack["icon_url"])) != "" {
		out["pack_icon"] = "/api/client/servers/" + str(server["uuid"]) + "/artwork/pack"
	}
	return out
}

func (a *App) serverNavigationFavorite(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "")
	if err != nil {
		fail(w, err)
		return
	}
	body, err := decode(r)
	if err != nil {
		fail(w, err)
		return
	}
	favorite, ok := body["favorite"].(bool)
	if !ok || len(body) != 1 {
		fail(w, bad("Provide favorite as a boolean."))
		return
	}
	err = a.exec(r.Context(), `INSERT INTO user_server_navigation(user_id,server_id,favorite) VALUES($1,$2,$3)
 ON CONFLICT(user_id,server_id) DO UPDATE SET favorite=excluded.favorite`, UserID(r), s["id"], favorite)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, item("server_navigation", M{"uuid": s["uuid"], "favorite": favorite}))
	a.liveEvents.navigationChanged(UserID(r))
}

func (a *App) serverNavigationVisit(w http.ResponseWriter, r *http.Request) {
	s, err := a.server(r, "")
	if err != nil {
		fail(w, err)
		return
	}
	err = a.exec(r.Context(), `INSERT INTO user_server_navigation(user_id,server_id,last_visited_at) VALUES($1,$2,now())
 ON CONFLICT(user_id,server_id) DO UPDATE SET last_visited_at=now()`, UserID(r), s["id"])
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
	a.liveEvents.navigationChanged(UserID(r))
}
