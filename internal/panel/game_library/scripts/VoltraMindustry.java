// SPDX-License-Identifier: GPL-3.0-only
// Separate Mindustry server launcher; uses the GPLv3 server's public APIs.
package mindustry.server;

import arc.Core;
import arc.Events;
import arc.files.Fi;
import arc.util.Log;
import arc.util.Timer;
import mindustry.Vars;
import mindustry.core.GameState.State;
import mindustry.game.EventType.RulesLoadEvent;
import mindustry.game.EventType.ServerLoadEvent;
import mindustry.game.Gamemode;
import mindustry.io.SaveIO;
import mindustry.maps.Map;
import mindustry.net.Administration.Config;

public final class VoltraMindustry {
    private static Fi persistentSave;

    public static void main(String[] args) {
        Events.on(ServerLoadEvent.class, event -> {
            try {
                configure();
                installSaveCommands();
                // Native startup commands and mod initialization finish first.
                Core.app.post(() -> {
                    try { resumeOrHost(); }
                    catch(Throwable error) { fail(error); }
                });
            } catch(Throwable error) { fail(error); }
        });
        ServerLauncher.main(new String[0]);
    }

    private static void configure() {
        // Validate creation controls before changing native settings in memory.
        String name = required("SAVE_NAME");
        if(name.equals(".") || name.equals("..") || name.contains("/") || name.contains("\\")) {
            throw new IllegalArgumentException("Save name must be a file name without a path.");
        }
        int port = integer("SERVER_PORT", 1, 65535);
        String serverName = required("SERVER_NAME");
        String description = System.getenv().getOrDefault("SERVER_DESCRIPTION", "");
        int players = integer("MAX_PLAYERS", 0, 999);
        int spacing = integer("AUTOSAVE_SECONDS", 30, 3600);
        String pause = required("AUTO_PAUSE");
        if(!pause.equals("0") && !pause.equals("1"))throw new IllegalArgumentException("Invalid AUTO_PAUSE.");
        required("MAPNAME");
        Gamemode.valueOf(required("GAMEMODE"));
        for(Config config : Config.all) {
            Object value = Core.settings.get(config.key, config.defaultValue);
            if(!config.defaultValue.getClass().isInstance(value))throw new IllegalArgumentException("Wrong native type for " + config.name);
        }
        if(Core.settings.has("playerlimit") && (!(Core.settings.get("playerlimit", 0) instanceof Integer) || Core.settings.getInt("playerlimit") < 0))throw new IllegalArgumentException("Invalid native player limit.");
        int nativeSpacing = Core.settings.getInt(Config.autosaveSpacing.key, spacing);
        if(nativeSpacing < 1)throw new IllegalArgumentException("Native autosave spacing must be positive.");

        persistentSave = Vars.saveDirectory.child(name + ".msav");
        seed(Config.serverName, serverName);
        seed(Config.desc, description);
        if(!Core.settings.has("playerlimit"))Core.settings.put("playerlimit", players);
        seed(Config.autoPause, pause.equals("1"));
        seed(Config.autosave, true);
        seed(Config.autosaveSpacing, spacing);
        // Persist publisher-defined scalar defaults so the shared native editor
        // can show them. Existing operator and opaque admin/player rows survive.
        for(Config config : Config.all)seed(config, config.defaultValue);
        Config.port.set(port);
        Config.autoUpdate.set(false);
        Core.settings.forceSave();
    }

    private static void seed(Config config, Object value) {
        if(!Core.settings.has(config.key))config.set(value);
    }

    private static void resumeOrHost() {
        if(!Vars.state.isGame()) {
            if(persistentSave.exists() || SaveIO.backupFileFor(persistentSave).exists()) {
                if(!SaveIO.isSaveValid(persistentSave))throw new IllegalStateException("The selected save is invalid. Restore a backup or select another save name.");
                SaveIO.load(persistentSave.exists() ? persistentSave : SaveIO.backupFileFor(persistentSave));
                Vars.state.rules.sector = null;
                Vars.state.set(State.playing);
                Vars.netServer.openServer();
                Log.info("VOLTRA_MINDUSTRY_RESUMED");
            } else {
                String selected = required("MAPNAME");
                Map map = Vars.maps.all().find(candidate -> candidate.plainName().equalsIgnoreCase(selected));
                if(map == null)throw new IllegalArgumentException("Selected map is unavailable. Upload it to config/maps or choose an installed map.");
                Gamemode mode = Gamemode.valueOf(required("GAMEMODE"));
                ServerControl.instance.lastMode = mode;
                Core.settings.put("lastServerMode", mode.name());
                Vars.logic.reset();
                Vars.world.loadMap(map, map.applyRules(mode));
                Vars.state.rules = map.applyRules(mode);
                Events.fire(new RulesLoadEvent(Vars.state.rules));
                Vars.logic.play();
                Vars.netServer.openServer();
                if(!savePersistent())throw new IllegalStateException("The new world could not be saved.");
                Log.info("VOLTRA_MINDUSTRY_NEW_WORLD");
            }
        }
        int seconds = Config.autosaveSpacing.num();
        Timer.schedule(() -> { if(Config.autosave.bool() && Vars.state.isGame())savePersistent(); }, seconds, seconds);
        Log.info("VOLTRA_MINDUSTRY_READY");
    }

    private static void installSaveCommands() {
        var handler = ServerControl.instance.handler;
        handler.removeCommand("exit");
        handler.register("exit", "Save the current world and exit the server.", arguments -> {
            if(!savePersistent())return;
            Log.info("Shutting down server.");
            Vars.net.dispose();
            Core.app.exit();
        });
        handler.removeCommand("stop");
        handler.register("stop", "Save the current world and stop hosting.", arguments -> {
            if(!savePersistent())return;
            Vars.net.closeServer();
            ServerControl.instance.cancelPlayTask();
            Vars.state.set(State.menu);
            Log.info("Stopped server.");
        });
    }

    private static boolean savePersistent() {
        try {
            if(Vars.state.isGame()) {
                SaveIO.save(persistentSave);
                Log.info("VOLTRA_MINDUSTRY_SAVED");
            }
            // Administration.save() only marks records dirty; serialize them
            // before flushing settings so a prompt Stop retains bans/admins.
            Vars.netServer.admins.forceSave();
            Core.settings.forceSave();
            return true;
        } catch(Throwable error) {
            Log.err("World save failed; server remains open so the save can be recovered.", error);
            return false;
        }
    }

    private static String required(String key) {
        String value = System.getenv(key);
        if(value == null || value.isBlank())throw new IllegalArgumentException("Missing setting: " + key);
        return value;
    }

    private static int integer(String key, int minimum, int maximum) {
        int value;
        try { value = Integer.parseInt(required(key)); }
        catch(NumberFormatException error) { throw new IllegalArgumentException("Invalid number for " + key); }
        if(value < minimum || value > maximum)throw new IllegalArgumentException("Invalid range for " + key);
        return value;
    }

    private static void fail(Throwable error) {
        Log.err("Mindustry setup failed: " + error.getMessage());
        System.exit(1);
    }
}
