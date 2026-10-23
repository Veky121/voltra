import java.nio.file.Files;
import java.nio.file.Path;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Acceptance-only Bukkit plugin; no Paper or Folia APIs required. */
public final class VoltraSpigotAcceptance extends JavaPlugin {
    @Override public void onEnable() {
        try {
            Path directory = getDataFolder().toPath();
            Files.createDirectories(directory);
            Path counter = directory.resolve("boots.txt");
            int previous = Files.exists(counter) ? Integer.parseInt(Files.readString(counter).trim()) : 0;
            Files.writeString(counter, Integer.toString(previous + 1) + "\n");
            getLogger().info("VOLTRA_PLUGIN_ENABLED boots=" + (previous + 1));
            getServer().getScheduler().runTask(this, () -> {
                World world = getServer().getWorlds().get(0);
                NamespacedKey key = new NamespacedKey(this, "acceptance");
                String marker = world.getPersistentDataContainer().get(key, PersistentDataType.STRING);
                getLogger().info("VOLTRA_WORLD_MARKER loaded=" + marker + " world=" + world.getName());
                if (marker == null) world.getPersistentDataContainer().set(key, PersistentDataType.STRING, "517077");
                getLogger().info("VOLTRA_WORLD_MARKER active=" + world.getPersistentDataContainer().get(key, PersistentDataType.STRING));
            });
        } catch (Exception error) { throw new IllegalStateException("Acceptance plugin persistence failed", error); }
    }
    @Override public void onDisable() { getLogger().info("VOLTRA_PLUGIN_DISABLED"); }
}
