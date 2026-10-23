package voltra.acceptance;

import net.minecraftforge.fml.common.Mod;

/** Acceptance-only mod compiled against the real selected Forge language API. */
@Mod("voltra_acceptance")
public final class VoltraForgeAcceptance {
    public VoltraForgeAcceptance() { VoltraModCounter.record(); }
}
