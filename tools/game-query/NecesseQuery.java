// MIT. Native status request using the installed publisher protocol classes.
// Compile against the matching Server.jar and run beside its locale/ directory;
// decoding native WorldSettings initializes publisher localization classes.
// This never joins a player session.
import java.net.*;
import java.util.concurrent.ThreadLocalRandom;
import necesse.engine.registries.PacketRegistry;
import necesse.engine.network.NetworkPacket;
import necesse.engine.network.networkInfo.DatagramNetworkInfo;
import necesse.engine.network.packet.PacketServerStatus;
import necesse.engine.network.packet.PacketServerStatusRequest;
import necesse.engine.platforms.Platform;
import necesse.engine.platforms.desktop.network.DesktopNetworkManager;

public final class NecesseQuery {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("HOST PORT");
        InetAddress host = InetAddress.getByName(args[0]);
        int port = Integer.parseInt(args[1]);
        // Registry setup needs the desktop networking provider, but not the
        // game platform initialization (which would initialize Steam/audio).
        var provider = Platform.class.getDeclaredField("networkManager");
        provider.setAccessible(true);
        provider.set(null, new DesktopNetworkManager());
        PacketRegistry.instance.registerCore();
        int state = ThreadLocalRandom.current().nextInt();
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout(4000);
            new NetworkPacket(new PacketServerStatusRequest(0, state), new DatagramNetworkInfo(socket, host, port)).sendPacket();
            DatagramPacket response = new DatagramPacket(new byte[65535], 65535);
            socket.receive(response);
            if (!response.getAddress().equals(host) || response.getPort() != port) throw new IllegalStateException("Unexpected status source");
            Object decoded = new NetworkPacket(socket, response).getTypePacket();
            if (!(decoded instanceof PacketServerStatus status) || status.state != state) throw new IllegalStateException("Unmatched status challenge");
            if (!status.version.matches("[A-Za-z0-9_.-]{1,64}")) throw new IllegalStateException("Unexpected version text");
            System.out.printf("VOLTRA_QUERY_JSON {\"protocol\":\"native Necesse status\",\"version\":\"%s\",\"slots\":%d,\"players\":%d,\"password\":%s,\"world_id\":\"%s\",\"player_join_verified\":false}%n",status.version,status.slots,status.playersOnline,status.passwordProtected,Long.toUnsignedString(status.uniqueID));
        }
    }
}
