// MIT. Original typed transport glue; no DepotDownloader code incorporated.
using SteamKit2;
using SteamKit2.Authentication;
using SteamKit2.Discovery;

namespace Voltra.SteamPrivate;

internal interface ISteamSession : IAsyncDisposable
{
    Task Connect(CancellationToken token);
    Task Authenticate(AuthSessionDetails details, CancellationToken token);
    Task<bool> CheckBeta(uint appId, string password, string branch, CancellationToken token);
}

internal static class BetaEntitlement
{
    public static bool Consume(EResult result, IDictionary<string, byte[]> keys, string branch)
    {
        try { return result == EResult.OK && keys.TryGetValue(branch, out var key) && key.Length == 32; }
        finally { foreach (var key in keys.Values) System.Security.Cryptography.CryptographicOperations.ZeroMemory(key); keys.Clear(); }
    }
}

internal static class SessionOperation
{
    // Validate before creating any transport. Explicit operation is mandatory.
    public static async Task Run(PrivateRequest request, IAuthenticator guard,
        Func<ISteamSession> factory, CancellationToken token)
    {
        TypedFields.Validate(request);
        if (request.Operation != "authenticate_beta") throw new WorkerError("invalid_operation");
        token.ThrowIfCancellationRequested();
        await using var session = factory();
        try
        {
            await session.Connect(token);
            await session.Authenticate(TypedFields.Authentication(request, guard), token);
            if (!string.IsNullOrEmpty(request.BetaPassword)
                && !await session.CheckBeta(request.AppId, request.BetaPassword, request.Branch, token))
                throw new WorkerError("beta_not_authorized");
            token.ThrowIfCancellationRequested();
        }
        catch (WorkerError) { throw; }
        catch (OperationCanceledException) { throw; }
        catch { throw new WorkerError("session_failed"); }
    }
}

internal sealed class SteamKitSession : ISteamSession, IAnonymousMetadataSession
{
    private readonly SteamClient client = new(SteamConfiguration.Create(b => b.WithServerListProvider(new MemoryServerListProvider())));
    private readonly CancellationTokenSource lifetime = new();
    private readonly TaskCompletionSource connected = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource loggedOn = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly List<IDisposable> subscriptions = [];
    private readonly Task pump;
    private readonly SteamUser user;
    private readonly SteamApps apps;
    private bool started, authenticated, anonymous, disposed;

    public SteamKitSession()
    {
        user = client.GetHandler<SteamUser>() ?? throw new WorkerError("session_unavailable");
        apps = client.GetHandler<SteamApps>() ?? throw new WorkerError("session_unavailable");
        var callbacks = new CallbackManager(client);
        subscriptions.Add(callbacks.Subscribe<SteamClient.ConnectedCallback>(_ => connected.TrySetResult()));
        subscriptions.Add(callbacks.Subscribe<SteamClient.DisconnectedCallback>(_ =>
        {
            connected.TrySetException(new WorkerError("connection_closed"));
            loggedOn.TrySetException(new WorkerError("connection_closed"));
        }));
        subscriptions.Add(callbacks.Subscribe<SteamUser.LoggedOnCallback>(result =>
        {
            if (result.Result == EResult.OK) loggedOn.TrySetResult();
            else loggedOn.TrySetException(new WorkerError("logon_rejected"));
        }));
        pump = Task.Run(() =>
        {
            try { while (!lifetime.IsCancellationRequested) callbacks.RunWaitCallbacks(TimeSpan.FromMilliseconds(50)); }
            catch { connected.TrySetException(new WorkerError("session_failed")); loggedOn.TrySetException(new WorkerError("session_failed")); }
        });
    }

    public async Task Connect(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (started || disposed) throw new WorkerError("invalid_session_state");
        started = true; client.Connect();
        await connected.Task.WaitAsync(token);
    }

    public async Task Authenticate(AuthSessionDetails details, CancellationToken token)
    {
        if (!started || authenticated || disposed || !connected.Task.IsCompletedSuccessfully)
            throw new WorkerError("invalid_session_state");
        // No persistent account store, DebugLog listener, console authenticator,
        // refresh-token event, or account identifier is published.
        var auth = await client.Authentication.BeginAuthSessionViaCredentialsAsync(details).WaitAsync(token);
        var result = await auth.PollingWaitForResultAsync(token).WaitAsync(token);
        var logon = new SteamUser.LogOnDetails { Username = result.AccountName,
            AccessToken = result.RefreshToken, ShouldRememberPassword = false, MachineName = "Voltra private worker" };
        try { token.ThrowIfCancellationRequested(); user.LogOn(logon); }
        finally { logon.AccessToken = null; logon.Username = null; }
        await loggedOn.Task.WaitAsync(token); authenticated = true;
    }

    public async Task LogOnAnonymous(CancellationToken token)
    {
        if (!started || authenticated || disposed || !connected.Task.IsCompletedSuccessfully)
            throw new WorkerError("invalid_session_state");
        token.ThrowIfCancellationRequested(); user.LogOnAnonymous();
        await loggedOn.Task.WaitAsync(token); authenticated = true; anonymous = true;
    }

    public async Task<AppMetadata> ReadAppMetadata(uint appId, CancellationToken token)
    {
        if (!authenticated || !anonymous || disposed) throw new WorkerError("invalid_session_state");
        token.ThrowIfCancellationRequested();
        var result = await apps.PICSGetProductInfo(new SteamApps.PICSRequest(appId), null, metaDataOnly: false).ToTask().WaitAsync(token);
        if (!result.Complete || result.Failed || result.Results is null) return MetadataProjection.Empty(appId, "incomplete");
        SteamApps.PICSProductInfoCallback.PICSProductInfo? info = null; var unknown = false;
        foreach (var response in result.Results)
        {
            unknown |= response.UnknownApps.Contains(appId);
            if (response.Apps.TryGetValue(appId, out var found))
            {
                if (info is not null) throw new WorkerError("invalid_metadata");
                info = found;
            }
        }
        if (unknown && info is not null) throw new WorkerError("invalid_metadata");
        return info is null ? MetadataProjection.Empty(appId, unknown ? "unknown" : "empty") : MetadataProjection.Project(appId, info);
    }

    public async Task<bool> CheckBeta(uint appId, string password, string branch, CancellationToken token)
    {
        if (!authenticated || anonymous || disposed) throw new WorkerError("invalid_session_state");
        TypedFields.ValidateBeta(password, branch);
        token.ThrowIfCancellationRequested();
        var reply = await apps.CheckAppBetaPassword(appId, password).ToTask().WaitAsync(token);
        return BetaEntitlement.Consume(reply.Result, reply.BetaPasswords, branch);
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        // Disconnect also cancels SteamKit pending jobs; no background transport
        // remains after this bounded callback pump has finished.
        await SessionTeardown.Run(() => { client.Disconnect(); return Task.CompletedTask; }, pump, lifetime, TimeSpan.FromSeconds(2));
        foreach (var subscription in subscriptions) subscription.Dispose();
        lifetime.Dispose();
    }
}
