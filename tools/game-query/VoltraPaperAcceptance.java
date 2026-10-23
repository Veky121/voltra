import java.nio.file.Files;
import java.nio.file.Path;
import org.bukkit.World;
import org.bukkit.NamespacedKey;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Acceptance-only plugin for owned disposable Paper/Folia/Purpur worlds. */
public final class VoltraPaperAcceptance extends JavaPlugin {
    @Override public void onEnable() {
        try {
            Path directory = getDataFolder().toPath();
            Files.createDirectories(directory);
            Path counter = directory.resolve("boots.txt");
            int previous = Files.exists(counter) ? Integer.parseInt(Files.readString(counter).trim()) : 0;
            Files.writeString(counter, Integer.toString(previous + 1) + "\n");
            getLogger().info("VOLTRA_PLUGIN_ENABLED boots=" + (previous + 1));
            // The global scheduler is shared by modern Paper and Folia. World
            // persistent data is serialized by the server's real save/Stop path.
            getServer().getGlobalRegionScheduler().execute(this, () -> {
                World world = getServer().getWorlds().get(0);
                NamespacedKey key = new NamespacedKey(this, "acceptance");
                String previousMarker = world.getPersistentDataContainer().get(key, PersistentDataType.STRING);
                getLogger().info("VOLTRA_WORLD_MARKER loaded=" + previousMarker + " world=" + world.getName());
                if (previousMarker == null) world.getPersistentDataContainer().set(key, PersistentDataType.STRING, "517077");
                getLogger().info("VOLTRA_WORLD_MARKER active=" + world.getPersistentDataContainer().get(key, PersistentDataType.STRING));
            });
        } catch (Exception error) { throw new IllegalStateException("Acceptance persistence failed", error); }
    }
    @Override public void onDisable() { getLogger().info("VOLTRA_PLUGIN_DISABLED"); }
}
