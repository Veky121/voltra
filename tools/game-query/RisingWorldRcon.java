import de.jiw.network.client.core.NetworkClient;
import de.jiw.rcon.serializing.Serializing;
import de.jiw.rcon.packets.*;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.concurrent.atomic.AtomicReference;

/** Read-only legacy Java RCON probe. Uses the matching publisher lib/*.jar.
 * Password is read from stdin and is never included in output or arguments. */
public final class RisingWorldRcon {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("HOST PORT required");
        String password = new BufferedReader(new InputStreamReader(System.in)).readLine();
        if (password == null || password.isEmpty()) throw new IllegalArgumentException("Password required on stdin");
        NetworkClient client = new NetworkClient("0.9.2", 1);
        Serializing.registerPacketSerializerRegistrations();
        AtomicReference<Boolean> authenticated = new AtomicReference<>();
        AtomicReference<Short> slots = new AtomicReference<>();
        client.addMessageListener((peer, message) -> authenticated.set(((LoginResponsePacket)message).success), LoginResponsePacket.class);
        client.addMessageListener((peer, message) -> slots.set(((ReturnServerInfoPacket)message).maxPlayers), ReturnServerInfoPacket.class);
        boolean infoSent = false;
        try {
            if (!client.connect(args[0], Integer.parseInt(args[1]))) throw new IllegalStateException("Connection rejected");
            // Match the publisher RCON client: its TCP-only channel does not
            // enter the gameplay client's UDP-completed Connected state.
            client.sendMessage(new LoginPacket(password));
            long end = System.nanoTime() + 10_000_000_000L;
            while (System.nanoTime() < end) {
                client.update(0.02f);
                if (Boolean.FALSE.equals(authenticated.get())) {
                    System.out.println("{\"authenticated\":false}"); return;
                }
                if (Boolean.TRUE.equals(authenticated.get()) && !infoSent) {
                    client.sendMessage(new RequestServerInfoPacket()); infoSent = true;
                }
                if (slots.get() != null) {
                    System.out.println("{\"authenticated\":true,\"maxplayers\":" + slots.get() + "}"); return;
                }
                Thread.sleep(20);
            }
            throw new IllegalStateException("RCON response timed out");
        } finally { client.terminate(); }
    }
}
