// MIT. TEST ONLY approved substitution. Production mappings are preserved.
namespace Voltra.SteamPrivate;
internal enum AccessProofKind { PrivateAccount, AnonymousPublic, Fixture }
internal static class AccessProof
{
    internal const string FixtureProvider = "fixture-private-content-v1";
    internal static string Provider(AccessProofKind kind) => kind switch
    {
        AccessProofKind.PrivateAccount => "steamkit-depot-v1",
        AccessProofKind.AnonymousPublic => "steamkit-public-depot-v1",
        AccessProofKind.Fixture => FixtureProvider,
        _ => throw new WorkerError("invalid_fixture_proof")
    };
    internal static string Name(AccessProofKind kind) => kind switch
    {
        AccessProofKind.PrivateAccount => "private_account",
        AccessProofKind.AnonymousPublic => "anonymous_public",
        AccessProofKind.Fixture => "fixture_mechanical_only",
        _ => throw new WorkerError("invalid_fixture_proof")
    };
    internal static bool Valid(PrivateReceipt receipt, AccessProofKind kind)
        => receipt.Provider == Provider(kind) && receipt.AccessProof == Name(kind)
            && receipt.EntitlementVerified == (kind == AccessProofKind.PrivateAccount)
            && receipt.AccountEntitlementVerified == (kind == AccessProofKind.PrivateAccount)
            && receipt.AnonymousAccessVerified == (kind == AccessProofKind.AnonymousPublic);
}
