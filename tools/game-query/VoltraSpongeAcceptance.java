package voltra.acceptance;

import java.nio.file.Files;
import java.nio.file.Path;
import org.spongepowered.api.Server;
import org.spongepowered.api.event.Listener;
import org.spongepowered.api.event.lifecycle.StartedEngineEvent;
import org.spongepowered.api.event.lifecycle.StoppingEngineEvent;
import org.spongepowered.plugin.builtin.jvm.Plugin;

/** Acceptance-only dedicated Sponge plugin compiled against real publisher APIs. */
@Plugin("voltra_acceptance")
public final class VoltraSpongeAcceptance {
    @Listener
    public void onStarted(final StartedEngineEvent<Server> event) {
        try {
            Path directory = Path.of("plugin-configs", "VoltraAcceptance");
            Files.createDirectories(directory);
            Path counter = directory.resolve("boots.txt");
            int previous = Files.exists(counter) ? Integer.parseInt(Files.readString(counter).trim()) : 0;
            Files.writeString(counter, Integer.toString(previous + 1) + "\n");
            System.out.println("VOLTRA_SPONGE_PLUGIN_LOADED boots=" + (previous + 1));
        } catch (Exception error) {
            throw new IllegalStateException("Acceptance-only Sponge counter failed", error);
        }
    }

    @Listener
    public void onStopping(final StoppingEngineEvent<Server> event) {
        System.out.println("VOLTRA_SPONGE_PLUGIN_STOPPING");
    }
}
