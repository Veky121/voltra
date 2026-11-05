// Standalone diagnostic only. Invokes the unchanged pinned publisher's config
// loader in this NEW process, never attaches to or changes the server process.
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Map;

class TachyonConfigProbe {
    public static void main(String[] args) throws Exception {
        Class<?> unsafeClass = Class.forName("sun.misc.Unsafe");
        Field singleton = unsafeClass.getDeclaredField("theUnsafe");
        singleton.setAccessible(true);
        Object unsafe = singleton.get(null);
        Class<?> engine = Class.forName("tk.spgames.spaceteamserver.e");
        // Its constructor starts the entire server. Allocate a diagnostic
        // receiver without that constructor; only call reviewed pure loaders.
        Object receiver = unsafeClass.getMethod("allocateInstance", Class.class).invoke(unsafe, engine);
        Method defaults = engine.getDeclaredMethod("bi");
        defaults.setAccessible(true);
        defaults.invoke(receiver);
        Method config = engine.getDeclaredMethod("bj");
        config.setAccessible(true);
        config.invoke(receiver);
        Map<?, ?> values = (Map<?, ?>) engine.getField("bS").get(null);
        for (String key : new String[]{"SERVER_PORT", "AUTOSAVE_TIME", "ALLOW_SERVER_RESET", "RESPAWN_TIME"}) {
            System.out.println("PUBLISHER_CONFIG_READBACK\t" + key + "\t" + values.get(key));
        }
    }
}
