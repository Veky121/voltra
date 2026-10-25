// MIT. Proof types are selected by trusted executable orchestration, never frames.
namespace Voltra.SteamPrivate;

internal enum AccessProofKind { PrivateAccount, AnonymousPublic, OfflineFixture }
internal static class AccessProof
{
    internal static string Provider(AccessProofKind kind) => kind switch { AccessProofKind.PrivateAccount => "steamkit-depot-v1", AccessProofKind.AnonymousPublic => "steamkit-public-depot-v1", _ => "fixture-private-content-v2" };
    internal static string Name(AccessProofKind kind) => kind switch { AccessProofKind.PrivateAccount => "private_account", AccessProofKind.AnonymousPublic => "anonymous_public", _ => "offline_fixture" };
    internal static bool Valid(PrivateReceipt receipt, AccessProofKind kind)
        => receipt.Provider == Provider(kind) && receipt.AccessProof == Name(kind)
            && receipt.EntitlementVerified == (kind == AccessProofKind.PrivateAccount)
            && receipt.AccountEntitlementVerified == (kind == AccessProofKind.PrivateAccount)
            && receipt.AnonymousAccessVerified == (kind == AccessProofKind.AnonymousPublic);
}
