// MIT. Injectable offline session state tests: never instantiate SteamClient.
using SteamKit2.Authentication;
using SteamKit2;
using SteamKit2.Internal;
using ProtoBuf;

namespace Voltra.SteamPrivate;

internal static class SessionTests
{
    private static void Check(bool ok) { if (!ok) throw new InvalidOperationException("session fixture"); }
    private sealed class NoGuard : IAuthenticator
    {
        public Task<string> GetDeviceCodeAsync(bool incorrect) => throw new InvalidOperationException();
        public Task<string> GetEmailCodeAsync(string email, bool incorrect) => throw new InvalidOperationException();
        public Task<bool> AcceptDeviceConfirmationAsync() => throw new InvalidOperationException();
    }
    private sealed class Session : ISteamSession
    {
        public readonly List<string> Calls = [];
        public AuthSessionDetails? Details;
        public string? Password, Branch;
        public uint AppId;
        public bool Allowed = true, Fail, Block, Challenge;
        public Task Connect(CancellationToken token) { token.ThrowIfCancellationRequested(); Calls.Add("connect"); if (Fail) throw new Exception("never emit publisher/private text"); return Task.CompletedTask; }
        public async Task Authenticate(AuthSessionDetails details, CancellationToken token)
        {
            Calls.Add("authenticate"); Details = details;
            if (Challenge) _ = await details.Authenticator!.GetDeviceCodeAsync(false);
            if (Block) await Task.Delay(Timeout.Infinite, token);
        }
        public Task<bool> CheckBeta(uint appId, string password, string branch, CancellationToken token)
        { token.ThrowIfCancellationRequested(); Calls.Add("beta"); AppId = appId; Password = password; Branch = branch; return Task.FromResult(Allowed); }
        public ValueTask DisposeAsync() { Calls.Add("dispose"); return ValueTask.CompletedTask; }
    }
    private static PrivateRequest Request(string? beta = "  +\"literal\" \\ \u0001\t\u007f λ  ") => new("authenticate_beta", "  literal user  ", "  +\"password\" \\  ", null, "preview", beta, 42, true);
    private static async Task Error(Func<Task> operation, string expected)
    { try { await operation(); throw new InvalidOperationException("expected rejection"); } catch (WorkerError error) { Check(error.Code == expected); } }

    public static async Task Run()
    {
        var guard = new NoGuard(); var request = Request(); var session = new Session();
        await SessionOperation.Run(request, guard, () => session, CancellationToken.None);
        Check(session.Calls.SequenceEqual(new[] { "connect", "authenticate", "beta", "dispose" }));
        Check(session.Details!.Username == request.Username && session.Details.Password == request.Password
            && session.Details.Authenticator == guard && !session.Details.IsPersistentSession && session.Details.GuardData is null);
        Check(session.Password == request.BetaPassword && session.AppId == request.AppId && session.Branch == request.Branch);

        foreach (var beta in new string?[] { null, "" })
        {
            session = new Session(); await SessionOperation.Run(Request(beta), guard, () => session, CancellationToken.None);
            Check(session.Calls.SequenceEqual(new[] { "connect", "authenticate", "dispose" }));
        }
        session = new Session { Allowed = false };
        await Error(() => SessionOperation.Run(request, guard, () => session, CancellationToken.None), "beta_not_authorized");
        Check(session.Calls.Last() == "dispose");
        session = new Session { Fail = true };
        await Error(() => SessionOperation.Run(request, guard, () => session, CancellationToken.None), "session_failed");
        Check(session.Calls.SequenceEqual(new[] { "connect", "dispose" }));

        var created = false;
        foreach (var bad in new[] { request with { Operation = "prepare_only" }, request with { Operation = "unexpected" }, request with { ParentFieldsValidated = false }, request with { BetaPassword = new string('λ', 513) } })
        {
            try { await SessionOperation.Run(bad, guard, () => { created = true; return new Session(); }, CancellationToken.None); throw new InvalidOperationException(); }
            catch (WorkerError) { Check(!created); }
        }
        using var before = new CancellationTokenSource(); before.Cancel();
        try { await SessionOperation.Run(request, guard, () => { created = true; return new Session(); }, before.Token); throw new InvalidOperationException(); }
        catch (OperationCanceledException) { Check(!created); }
        session = new Session { Block = true }; using var during = new CancellationTokenSource(TimeSpan.FromMilliseconds(30));
        try { await SessionOperation.Run(request, guard, () => session, during.Token); throw new InvalidOperationException(); }
        catch (OperationCanceledException) { Check(session.Calls.SequenceEqual(new[] { "connect", "authenticate", "dispose" })); }
        using var guardCancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(30));
        session = new Session { Challenge = true };
        await Error(() => SessionOperation.Run(request,
            new FdAuthenticator(new WaitingMessages(), TimeSpan.FromSeconds(1), guardCancel.Token),
            () => session, guardCancel.Token), "cancelled");
        Check(session.Calls.SequenceEqual(new[] { "connect", "authenticate", "dispose" }));
    }

    private sealed class WaitingMessages : IPrivateMessages
    {
        public Task SendAsync<T>(T message, CancellationToken token) => Task.CompletedTask;
        public async Task<T> ReceiveAsync<T>(CancellationToken token) { await Task.Delay(Timeout.Infinite, token); throw new InvalidOperationException(); }
    }

    public static Task BetaReply()
    {
        foreach (var (result, branch, length, allowed) in new[] { (EResult.OK, "preview", 32, true), (EResult.AccessDenied, "preview", 32, false), (EResult.OK, "other", 32, false), (EResult.OK, "preview", 31, false) })
        {
            var packet = new CMsgClientCheckAppBetaPasswordResponse { eresult = (int)result };
            // Generated actual upstream response, round-tripped by protobuf-net.
            packet.betapasswords.Add(new CMsgClientCheckAppBetaPasswordResponse.BetaPassword { betaname = branch, betapassword = new string('a', length * 2) });
            using var stream = new MemoryStream(); Serializer.Serialize(stream, packet); stream.Position = 0;
            var decoded = Serializer.Deserialize<CMsgClientCheckAppBetaPasswordResponse>(stream);
            var keys = decoded.betapasswords.ToDictionary(row => row.betaname, row => Convert.FromHexString(row.betapassword));
            var raw = keys.Values.Single();
            Check(BetaEntitlement.Consume((EResult)decoded.eresult, keys, "preview") == allowed);
            Check(keys.Count == 0 && raw.All(b => b == 0));
        }
        return Task.CompletedTask;
    }
}
