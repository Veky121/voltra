package voltra.acceptance;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/** Shared acceptance-only mod persistence using Java8-compatible file APIs. */
public final class VoltraModCounter {
    public static void record() {
        try {
            Path file = Paths.get("config", "VoltraAcceptance", "boots.txt");
            Files.createDirectories(file.getParent());
            int previous = Files.exists(file) ? Integer.parseInt(new String(Files.readAllBytes(file), StandardCharsets.UTF_8).trim()) : 0;
            Files.write(file, (Integer.toString(previous + 1) + "\n").getBytes(StandardCharsets.UTF_8));
            System.out.println("VOLTRA_SERVER_MOD_LOADED boots=" + (previous + 1));
        } catch (Exception error) { throw new IllegalStateException("Acceptance mod persistence failed", error); }
    }
}
