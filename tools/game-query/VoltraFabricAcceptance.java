import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.api.ModInitializer;

/** Acceptance-only server mod, compiled against the actual publisher loader. */
public final class VoltraFabricAcceptance implements ModInitializer {
    @Override public void onInitialize() {
        try {
            Path file = Path.of("config", "VoltraAcceptance", "boots.txt");
            Files.createDirectories(file.getParent());
            int boots = Files.exists(file) ? Integer.parseInt(Files.readString(file).trim()) : 0;
            Files.writeString(file, Integer.toString(boots + 1) + "\n");
            System.out.println("VOLTRA_SERVER_MOD_LOADED boots=" + (boots + 1));
        } catch (Exception error) { throw new IllegalStateException("Acceptance mod persistence failed", error); }
    }
}
