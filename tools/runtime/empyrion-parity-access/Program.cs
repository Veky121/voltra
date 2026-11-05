// MIT. Nonshipping, fixed read-only anonymous depot authorization probe.
// No content/CDN requests, free-license activation, private login or game launch.
using System.Security.Cryptography;
using System.Text.Json;
using SteamKit2;
using SteamKit2.Discovery;

internal static class Program
{
    private const uint App = 530870, Depot = 530871;
    private const ulong Manifest = 8329430202076268665UL;
    private static void Emit(object row) => Console.WriteLine(JsonSerializer.Serialize(row));

    public static async Task<int> Main(string[] args)
    {
        if (args.SequenceEqual(new[] { "--offline-scope" }))
        {
            Emit(new { app = App, depot = Depot, manifest = Manifest.ToString(), branch = "public",
                anonymous_only = true, game_content_requests = 0, license_activation = false });
            return 0;
        }
        if (!args.SequenceEqual(new[] { "--approved-anonymous-depot-access" })) return 2;
        DebugLog.Enabled = false;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        await using var session = new Session();
        try
        {
            var login = await session.Connect(deadline.Token);
            Emit(new { stage = "anonymous_logon", result = login.ToString(), credentials_used = false });
            if (login != EResult.OK) return 3;
            var apps = session.Client.GetHandler<SteamApps>()!;
            var response = await apps.PICSGetProductInfo(new SteamApps.PICSRequest(App), null, false)
                .ToTask().WaitAsync(deadline.Token);
            if (!response.Complete || response.Failed || response.Results is null) throw new InvalidOperationException("metadata_incomplete");
            KeyValue? app = null;
            foreach (var part in response.Results)
            {
                if (part.UnknownApps.Contains(App)) throw new InvalidOperationException("metadata_unknown");
                if (part.Apps.TryGetValue(App, out var info))
                {
                    if (app is not null || info.MissingToken || info.UseHttp) throw new InvalidOperationException("metadata_scope_unknown");
                    app = info.KeyValues;
                }
            }
            if (app?["appid"].Value != App.ToString()
                || app["depots"][Depot.ToString()]["manifests"]["public"]["gid"].Value != Manifest.ToString())
            {
                Emit(new { stage = "publisher_metadata_changed_or_missing", access = "unknown", content_downloaded = false });
                return 4;
            }
            Emit(new { stage = "exact_manifest_confirmed", app = App, depot = Depot, manifest = Manifest.ToString() });
            var keyReply = await apps.GetDepotDecryptionKey(Depot, App).ToTask().WaitAsync(deadline.Token);
            var key = keyReply.DepotKey;
            var validKey = false;
            try
            {
                validKey = keyReply.Result == EResult.OK && keyReply.DepotID == Depot && key is { Length: 32 };
                Emit(new { stage = "depot_authorization", result = keyReply.Result.ToString(),
                    expected_depot = keyReply.DepotID == Depot, valid_key_issued = validKey,
                    key_logged = false, key_persisted = false });
            }
            finally { if (key is not null) CryptographicOperations.ZeroMemory(key); }
            if (!validKey) return 5;
            ulong requestCode = await session.Client.GetHandler<SteamContent>()!
                .GetManifestRequestCode(Depot, App, Manifest, "public").WaitAsync(deadline.Token);
            var granted = requestCode != 0;
            requestCode = 0;
            Emit(new { stage = "manifest_authorization", request_code_issued = granted,
                request_code_logged = false, request_code_persisted = false,
                anonymous_depot_access = granted, account_ownership_claimed = false,
                content_downloaded = false, manifest_downloaded = false, chunks_requested = 0,
                native_game_acceptance = false });
            return granted ? 0 : 6;
        }
        catch (OperationCanceledException)
        {
            Emit(new { stage = "probe_timeout", access = "unknown", content_downloaded = false }); return 7;
        }
        catch (Exception error)
        {
            // Exception messages/stacks may contain SDK request data; never emit them.
            Emit(new { stage = "probe_failed", exception_kind = error.GetType().Name,
                access = "unknown", paid_license_gate_inferred = false, content_downloaded = false }); return 8;
        }
    }

    private sealed class Session : IAsyncDisposable
    {
        internal SteamClient Client { get; } = new(SteamConfiguration.Create(builder =>
            builder.WithServerListProvider(new MemoryServerListProvider())));
        private readonly TaskCompletionSource connected = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<EResult> loggedOn = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly CancellationTokenSource lifetime = new();
        private readonly List<IDisposable> subscriptions = [];
        private readonly Task pump;

        internal Session()
        {
            var callbacks = new CallbackManager(Client);
            subscriptions.Add(callbacks.Subscribe<SteamClient.ConnectedCallback>(_ => connected.TrySetResult()));
            subscriptions.Add(callbacks.Subscribe<SteamClient.DisconnectedCallback>(_ =>
            {
                connected.TrySetException(new InvalidOperationException("cm_closed"));
                loggedOn.TrySetException(new InvalidOperationException("cm_closed"));
            }));
            subscriptions.Add(callbacks.Subscribe<SteamUser.LoggedOnCallback>(row => loggedOn.TrySetResult(row.Result)));
            pump = Task.Run(() =>
            {
                while (!lifetime.IsCancellationRequested) callbacks.RunWaitCallbacks(TimeSpan.FromMilliseconds(50));
            });
        }

        internal async Task<EResult> Connect(CancellationToken cancellation)
        {
            Client.Connect(); await connected.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellation);
            Client.GetHandler<SteamUser>()!.LogOnAnonymous();
            return await loggedOn.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellation);
        }

        public async ValueTask DisposeAsync()
        {
            try { Client.Disconnect(); } catch { }
            lifetime.Cancel();
            try { await pump.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
            foreach (var subscription in subscriptions) subscription.Dispose();
            lifetime.Dispose();
        }
    }
}
