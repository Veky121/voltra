package voltra.acceptance;

import net.neoforged.fml.common.Mod;

/** Acceptance-only mod compiled against the real selected NeoForge loader API. */
@Mod("voltra_acceptance")
public final class VoltraNeoForgeAcceptance {
    public VoltraNeoForgeAcceptance() { VoltraModCounter.record(); }
}
