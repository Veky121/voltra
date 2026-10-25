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

internal sealed class SteamKitSession : ISteamSession, IAnonymousMetadataSession, IContentSession
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
    private sealed record LicenseSnapshot(long Revision, IReadOnlyList<LicensedPackage> Licenses);
    private readonly TaskCompletionSource licensesReady = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private LicenseSnapshot? licenseSnapshot;
    private long licenseRevision;

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
        subscriptions.Add(callbacks.Subscribe<SteamApps.LicenseListCallback>(result =>
        {
            var revision = Interlocked.Increment(ref licenseRevision);
            if (result.Result != EResult.OK)
            {
                Volatile.Write(ref licenseSnapshot, null);
                licensesReady.TrySetException(new WorkerError("license_list_denied"));
                return;
            }
            Volatile.Write(ref licenseSnapshot, new(revision, result.LicenseList.Select(l => new LicensedPackage(l.PackageID, l.AccessToken, l.LicenseFlags)).ToArray()));
            licensesReady.TrySetResult();
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

    public async Task<EntitledPlan> ReadEntitledPlan(ContentSelection selection, CancellationToken cancellation, string? betaPassword = null)
    {
        if (!authenticated || anonymous || disposed) throw new WorkerError("authenticated_session_required");
        await licensesReady.Task.WaitAsync(cancellation);
        var snapshot = Volatile.Read(ref licenseSnapshot) ?? throw new WorkerError("license_list_denied");
        if (snapshot.Licenses.Count > 4096) throw new WorkerError("invalid_license_list");
        var packages = new Dictionary<uint, KeyValue>();
        foreach (var license in snapshot.Licenses.Where(l => EntitledSelection.Active(l.Flags)))
        {
            var response = await apps.PICSGetProductInfo(null, new SteamApps.PICSRequest(license.Id, license.Token), false).ToTask().WaitAsync(cancellation);
            if (!response.Complete || response.Failed || response.Results is null) throw new WorkerError("package_access_missing");
            foreach (var batch in response.Results)
            {
                if (batch.UnknownPackages.Contains(license.Id)) throw new WorkerError("package_access_missing");
                if (batch.Packages.TryGetValue(license.Id, out var info))
                {
                    if (info.MissingToken || !packages.TryAdd(license.Id, info.KeyValues)) throw new WorkerError("package_access_missing");
                }
            }
        }
        var inventory = EntitledSelection.Inventory(snapshot.Licenses, packages);
        if (!inventory.Apps.Contains(selection.App)) throw new WorkerError("app_entitlement_missing");
        var metadata = new Dictionary<uint, KeyValue>();
        var pending = new Queue<uint>(); pending.Enqueue(selection.App);
        while (pending.TryDequeue(out var appId))
        {
            if (metadata.ContainsKey(appId)) continue;
            if (metadata.Count >= 64) throw new WorkerError("shared_app_metadata_limit");
            var tokens = await apps.PICSGetAccessTokens(appId, null).ToTask().WaitAsync(cancellation);
            if (tokens.AppTokensDenied.Contains(appId)) throw new WorkerError("app_access_missing");
            tokens.AppTokens.TryGetValue(appId, out var accessToken);
            var response = await apps.PICSGetProductInfo(new SteamApps.PICSRequest(appId, accessToken), null, false).ToTask().WaitAsync(cancellation);
            if (!response.Complete || response.Failed || response.Results is null) throw new WorkerError("app_access_missing");
            foreach (var batch in response.Results)
            {
                if (batch.UnknownApps.Contains(appId)) throw new WorkerError("app_access_missing");
                if (batch.Apps.TryGetValue(appId, out var info))
                {
                    if (info.MissingToken || info.OnlyPublic || !metadata.TryAdd(appId, info.KeyValues)) throw new WorkerError("app_access_missing");
                }
            }
            if (!metadata.TryGetValue(appId, out var app)) throw new WorkerError("app_access_missing");
            foreach (var depot in app["depots"].Children)
            {
                var shared = MetadataUInt64.ParseCanonical(depot["depotfromapp"].Value);
                if (shared is > 0 and <= uint.MaxValue && !metadata.ContainsKey((uint)shared.Value)) pending.Enqueue((uint)shared.Value);
            }
        }
        if (Volatile.Read(ref licenseRevision) != snapshot.Revision) throw new WorkerError("entitlement_changed");
        if (betaPassword is null) return EntitledSelection.Select(selection, inventory, metadata, snapshot.Revision);
        TypedFields.ValidateBeta(betaPassword, selection.Branch);
        var beta = await apps.CheckAppBetaPassword(selection.App, betaPassword).ToTask().WaitAsync(cancellation);
        try
        {
            if (beta.Result != EResult.OK || !beta.BetaPasswords.TryGetValue(selection.Branch, out var key) || key.Length != 32)
                throw new WorkerError("beta_not_authorized");
            if (Volatile.Read(ref licenseRevision) != snapshot.Revision) throw new WorkerError("entitlement_changed");
            return EntitledSelection.Select(selection, inventory, metadata, snapshot.Revision, beta.BetaPasswords);
        }
        finally
        {
            foreach (var key in beta.BetaPasswords.Values) System.Security.Cryptography.CryptographicOperations.ZeroMemory(key);
            beta.BetaPasswords.Clear();
        }
    }

    public IDepotTransport CreateDepotTransport(EntitledPlan plan, DepotRequest request)
    {
        if (!authenticated || anonymous || disposed || !plan.Depots.Contains(request) || Volatile.Read(ref licenseRevision) != plan.LicenseRevision)
            throw new WorkerError("entitlement_changed");
        return new SteamKitDepotTransport(client, request, () => !disposed && authenticated && !anonymous
            && Volatile.Read(ref licenseRevision) == plan.LicenseRevision && Volatile.Read(ref licenseSnapshot) is not null);
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
