// MIT. Separate nonshipping, root-approved bounded anonymous app1007 proof only.
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SteamKit2;
using SteamKit2.CDN;
using SteamKit2.Discovery;
using Voltra.SteamPrivate;

namespace ApprovedAnonymousProof;

internal static class Program
{
    internal const ulong Budget = 256UL * 1024 * 1024;
    internal static readonly JsonSerializerOptions Json = ParentReceiptBoundary.Json;
    internal static long WireBytes;
    internal static PublicTransportMode TransportMode = PublicTransportMode.RequireScopedToken;
    internal const string ProofScopeVersion = "official-steampipe-v1";
    internal static void Event(object value) => Console.WriteLine(JsonSerializer.Serialize(value, Json));
    [DllImport("libc", SetLastError = true)] private static extern int open(string path, int flags);
    [DllImport("libc")] private static extern int close(int descriptor);
    private static PrivateDirectory Root(string name, bool privateModes)
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("proof_platform_unsupported");
        var path = (TransportMode == PublicTransportMode.ExplicitPublicCdn ? "/work/anonymous-official-steampipe-proof/" : "/work/anonymous-proof/") + name;
        Directory.CreateDirectory(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var fd = open(path, 0xb0000);
        if (fd < 0) throw new WorkerError("proof_descriptor_failed");
        try { return new(fd, privateModes); } finally { _ = close(fd); }
    }
    private static string Digest(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    public static async Task<int> Main(string[] args)
    {
        DebugLog.Enabled = false;
        if (args.SequenceEqual(new[] { "--offline-guards" })) return await Guards();
        if (args.SequenceEqual(new[] { "--approved-app1007-public-cdn-proof" })) TransportMode = PublicTransportMode.ExplicitPublicCdn;
        else if (!args.SequenceEqual(new[] { "--approved-app1007-anonymous-proof" })) return 2;
        using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(12));
        try
        {
            using var target = Root("target", false); using var work = Root("work", true); using var cache = Root("cache", true);
            if (cache.StorageBytes() != 4096) throw new WorkerError("proof_cache_not_cold");
            EntitledPlan? coldPlan = null; PrivateReceipt? previous = null;
            var selection = new ContentSelection(1007, "public", "linux", "64", "english", new HashSet<uint>());
            for (var pass = 0; pass < 2; pass++)
            {
                await using var session = new Session();
                await session.Connect(deadline.Token);
                var app = await session.Metadata(deadline.Token);
                var plan = Select(app);
                if (coldPlan is not null && (coldPlan.Build != plan.Build || !coldPlan.Depots.SequenceEqual(plan.Depots))) throw new WorkerError("proof_publisher_changed");
                coldPlan ??= plan;
                Event(new { Stage = "metadata_selected", Pass = pass == 0 ? "cold" : "fresh_reauth_cache", App = 1007, Build = new MetadataUInt64(plan.Build),
                    Branch = "public", Platform = "linux", Architecture = "64", Language = "english", Depots = plan.Depots.Select(d => new ReceiptDepot(d.App, d.Depot, d.Manifest)), ContentCap = new MetadataUInt64(Budget) });
                var scope = new PublicationScope(Digest("approved-app1007-proof-server"), Digest("approved-anonymous-proof-owner"),
                    Digest("app1007-proof-job-" + ProofScopeVersion + TransportMode + pass), Digest("app1007-proof-nonce-" + ProofScopeVersion + TransportMode + pass), Digest("1007|public|linux|64|english|" + ProofScopeVersion + TransportMode + pass));
                var publication = new StagedPublication(target, work, scope, ["config", "saves", "mods"], AccessProofKind.AnonymousPublic);
                publication.Admit();
                cache.LockExclusive();
                try
                {
                    var transports = new List<Transport>();
                    var receipt = await GameContentCoordinator.Run(plan, selection, request =>
                    {
                        var transport = new Transport(session, request); transports.Add(transport);
                        return new PrivateChunkCache(transport, cache, scope.Server, scope.Owner, 768UL * 1024 * 1024, externallyLocked: true);
                    }, publication, Budget, 512UL * 1024 * 1024, previous, deadline.Token);
                    var reference = ParentReceiptBoundary.Reference(work, receipt);
                    ParentReceiptBoundary.Validate(work, target, reference, scope, selection, plan, Budget, AccessProofKind.AnonymousPublic);
                    var downloaded = transports.Sum(t => t.DownloadedBytes);
                    if (pass == 1 && downloaded != 0) throw new WorkerError("proof_warm_cache_miss");
                    try { ParentReceiptBoundary.Validate(work, target, reference, scope, selection, plan, Budget); throw new WorkerError("private_bridge_accepted_public_proof"); }
                    catch (WorkerError error) when (error.Code == "invalid_provider_receipt") { }
                    Event(new { Stage = "publication_verified", Pass = pass == 0 ? "cold" : "fresh_reauth_cache", Provider = receipt.Provider,
                        Receipt = reference, Files = new MetadataUInt64((ulong)receipt.Files.Count), Directories = receipt.Directories?.Count ?? 0, Links = receipt.Links?.Count ?? 0,
                        DownloadedChunkBytes = new MetadataUInt64((ulong)downloaded), HttpResponseBytes = new MetadataUInt64((ulong)Interlocked.Read(ref WireBytes)),
                        AnonymousAccessVerified = true, AccountEntitlementVerified = false, NativeAcceptanceVerified = false, ProductionEnabled = false });
                    previous = receipt;
                }
                finally { cache.Unlock(); }
            }
            return 0;
        }
        catch (WorkerError error) { Event(new { Stage = "failed", Code = error.Code, HttpResponseBytes = new MetadataUInt64((ulong)Math.Max(0, WireBytes)), NoFallback = true }); return 3; }
        catch (OperationCanceledException) { Event(new { Stage = "failed", Code = "proof_cancelled", NoFallback = true }); return 4; }
        catch { Event(new { Stage = "failed", Code = "proof_transport_failed", NoFallback = true }); return 5; }
    }

    internal static EntitledPlan Select(KeyValue app)
    {
        if (app["appid"].Value != "1007") throw new WorkerError("proof_app_identity_mismatch");
        var build = MetadataUInt64.ParseCanonical(app["depots"]["branches"]["public"]["buildid"].Value);
        if (build is null or 0) throw new WorkerError("proof_public_build_missing");
        var depots = new List<DepotRequest>(); ulong total = 0; var ids = new HashSet<uint>();
        foreach (var depot in app["depots"].Children)
        {
            var number = MetadataUInt64.ParseCanonical(depot.Name);
            if (number is null or 0 or > uint.MaxValue) continue;
            var config = depot["config"];
            var os = config["oslist"].Value; var arch = config["osarch"].Value; var language = config["language"].Value;
            if (!string.IsNullOrEmpty(os) && !os.Split(',').Contains("linux", StringComparer.Ordinal)
                || !string.IsNullOrEmpty(arch) && arch != "64" || !string.IsNullOrEmpty(language) && language != "english") continue;
            if (depot["depotfromapp"].Value is not null || depot["dlcappid"].Value is not null) throw new WorkerError("proof_unexpected_shared_or_dlc_prerequisite");
            var manifest = depot["manifests"]["public"];
            var gid = MetadataUInt64.ParseCanonical(manifest["gid"].Value ?? manifest.Value);
            var size = MetadataUInt64.ParseCanonical(manifest["size"].Value);
            if (gid is null or 0 || size is null) throw new WorkerError("proof_incomplete_manifest_metadata");
            if (size.Value > Budget - total) throw new WorkerError("proof_content_cap_exceeded");
            total += size.Value;
            if (!ids.Add((uint)number.Value) || depots.Count >= 128) throw new WorkerError("proof_invalid_depot_metadata");
            depots.Add(new(1007, (uint)number.Value, gid.Value, "public"));
        }
        if (depots.Count == 0) throw new WorkerError("proof_no_linux64_depots");
        Event(new { Stage = "metadata_budget", SelectedBytes = new MetadataUInt64(total), SelectedDepots = depots.Count });
        return new(1007, build.Value, depots, 0);
    }

    private static async Task<int> Guards()
    {
        var result = await SelfTests.Run();
        if (result != 0) return result;
        PublicCdnPolicy.Guards();
        using (var probe = new SocketProbe())
        using (var invoker = new HttpMessageInvoker(probe))
        using (var socket = new ClientWebSocket())
        {
            try { await socket.ConnectAsync(new Uri("wss://offline-fixture.invalid/"), invoker, CancellationToken.None); return 1; }
            catch (WebSocketException) { }
            if (probe.Scheme is not ("wss" or "https")) return 1;
            Event(new { Stage = "offline_websocket_handshake_probe", Network = false, ObservedRequestScheme = probe.Scheme, ResponseBodyMustRemainUnbuffered = true });
        }
        var app = KeyValue.LoadFromString("\"appinfo\" { \"appid\" \"1007\" \"depots\" { \"branches\" { \"public\" { \"buildid\" \"1\" } } \"1006\" { \"config\" { \"oslist\" \"linux\" \"osarch\" \"64\" } \"manifests\" { \"public\" { \"gid\" \"1\" \"size\" \"268435457\" } } } } }")!;
        try { Select(app); return 1; } catch (WorkerError error) when (error.Code == "proof_content_cap_exceeded") { }
        using (var fixture = new StorageTests.Fixture())
        {
            var scope = new PublicationScope(new('a', 64), new('b', 64), new('c', 64), new('1', 64), new('d', 64));
            var publisher = new StagedPublication(fixture.Target, fixture.Work, scope, [], AccessProofKind.AnonymousPublic);
            publisher.Admit(); var bytes = "offline public proof guard"u8.ToArray();
            using (var staged = await publisher.CreateStage(new() { FileName = "bin/example" })) await staged.WriteAsync(bytes);
            var file = new VerifiedFile("bin/example", Convert.ToHexString(SHA1.HashData(bytes)).ToLowerInvariant(), Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), bytes.Length);
            var receipt = publisher.Publish(new(1007, 1006, 1, "public"), 1, "linux", "64", "english", [file], null);
            var reference = ParentReceiptBoundary.Reference(fixture.Work, receipt);
            var selection = new ContentSelection(1007, "public", "linux", "64", "english", new HashSet<uint>());
            ParentReceiptBoundary.Validate(fixture.Work, fixture.Target, reference, scope, selection, byteBudget: Budget, expectedProof: AccessProofKind.AnonymousPublic);
            if (receipt.AccountEntitlementVerified || receipt.EntitlementVerified || !receipt.AnonymousAccessVerified) return 1;
            try { ParentReceiptBoundary.Validate(fixture.Work, fixture.Target, reference, scope, selection); return 1; }
            catch (WorkerError error) when (error.Code == "invalid_provider_receipt") { }
        }
        Event(new { Stage = "offline_proof_guards_passed", Network = false, ContentCap = new MetadataUInt64(Budget) }); return 0;
    }
}

internal sealed class BoundedHandler : HttpClientHandler
{
    private readonly HttpClientPurpose purpose;
    public BoundedHandler(HttpClientPurpose purpose) { this.purpose = purpose; AllowAutoRedirect = false; AutomaticDecompression = DecompressionMethods.None; }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
    {
        if (request.RequestUri?.Scheme != "https") throw new WorkerError("proof_https_required");
        var response = await base.SendAsync(request, cancellation);
        try
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                Program.Event(new { Stage = "http_access_denied", Purpose = purpose.ToString(), Status = (int)response.StatusCode, NoRetry = true });
                throw new WorkerError("proof_http_access_denied");
            }
            const int limit = 20 * 1024 * 1024;
            if (response.Content.Headers.ContentLength is > limit) throw new WorkerError("proof_response_cap_exceeded");
            using var input = await response.Content.ReadAsStreamAsync(cancellation);
            using var output = new MemoryStream(); var buffer = new byte[65536];
            while (true)
            {
                var count = await input.ReadAsync(buffer, cancellation); if (count == 0) break;
                if (output.Length + count > limit || Interlocked.Add(ref Program.WireBytes, count) > (long)Program.Budget) throw new WorkerError("proof_response_cap_exceeded");
                output.Write(buffer, 0, count);
            }
            var content = new ByteArrayContent(output.ToArray());
            foreach (var header in response.Content.Headers) content.Headers.TryAddWithoutValidation(header.Key, header.Value);
            response.Content.Dispose(); response.Content = content; return response;
        }
        catch { response.Dispose(); throw; }
    }
}

internal sealed class SocketProbe : HttpMessageHandler
{
    internal string? Scheme;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
    {
        Scheme = request.RequestUri?.Scheme;
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest) { Content = new ByteArrayContent([]) });
    }
}

internal static class PurposeClients
{
    internal static HttpClient Create(HttpClientPurpose purpose)
    {
        // A CM websocket is a live upgraded stream, not a bounded HTTP artifact.
        // SteamKit constructs a wss:// URI and owns its callback/message limits.
        // Do not consume or replace the upgrade response body.
        if (purpose == HttpClientPurpose.CMWebSocket)
            return new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(45) };
        return new HttpClient(new BoundedHandler(purpose)) { Timeout = TimeSpan.FromSeconds(45) };
    }
}

internal sealed class Session : IAsyncDisposable
{
    internal readonly SteamClient Client = new(SteamConfiguration.Create(builder => builder.WithServerListProvider(new MemoryServerListProvider())
        .WithHttpClientFactory(PurposeClients.Create)));
    private readonly TaskCompletionSource connected = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource loggedOn = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly CancellationTokenSource lifetime = new();
    private readonly List<IDisposable> subscriptions = [];
    private readonly Task pump;
    internal bool Ready;
    private bool connectedSeen;
    internal Session()
    {
        var callbacks = new CallbackManager(Client);
        subscriptions.Add(callbacks.Subscribe<SteamClient.ConnectedCallback>(_ => { connectedSeen = true; Program.Event(new { Stage = "cm_connected" }); connected.TrySetResult(); }));
        subscriptions.Add(callbacks.Subscribe<SteamClient.DisconnectedCallback>(reply =>
        {
            Program.Event(new { Stage = "cm_disconnected", ConnectedSeen = connectedSeen, AnonymousLogonSeen = Ready, reply.UserInitiated });
            Ready = false; connected.TrySetException(new WorkerError("proof_connection_closed")); loggedOn.TrySetException(new WorkerError("proof_connection_closed"));
        }));
        subscriptions.Add(callbacks.Subscribe<SteamUser.LoggedOnCallback>(reply =>
        {
            Program.Event(new { Stage = "anonymous_logon_callback", Result = reply.Result.ToString() });
            if (reply.Result == EResult.OK) { Ready = true; loggedOn.TrySetResult(); }
            else loggedOn.TrySetException(new WorkerError("proof_anonymous_logon_denied"));
        }));
        pump = Task.Run(() => { while (!lifetime.IsCancellationRequested) callbacks.RunWaitCallbacks(TimeSpan.FromMilliseconds(50)); });
    }
    internal async Task Connect(CancellationToken cancellation)
    {
        Client.Connect(); await connected.Task.WaitAsync(TimeSpan.FromSeconds(60), cancellation);
        Client.GetHandler<SteamUser>()!.LogOnAnonymous(); await loggedOn.Task.WaitAsync(TimeSpan.FromSeconds(60), cancellation);
        Program.Event(new { Stage = "anonymous_logon", Result = "OK", AccountCredentialsUsed = false });
    }
    internal async Task<KeyValue> Metadata(CancellationToken cancellation)
    {
        var reply = await Client.GetHandler<SteamApps>()!.PICSGetProductInfo(new SteamApps.PICSRequest(1007), null, false).ToTask().WaitAsync(cancellation);
        if (!reply.Complete || reply.Failed || reply.Results is null) throw new WorkerError("proof_pics_incomplete");
        KeyValue? app = null;
        foreach (var part in reply.Results)
        {
            if (part.UnknownApps.Contains(1007)) throw new WorkerError("proof_app_unknown");
            if (part.Apps.TryGetValue(1007, out var info))
            {
                if (app is not null || info.MissingToken || info.UseHttp) throw new WorkerError("proof_pics_access_missing");
                app = info.KeyValues;
            }
        }
        return app ?? throw new WorkerError("proof_app_missing");
    }
    public async ValueTask DisposeAsync()
    {
        Ready = false;
        await SessionTeardown.Run(() => { Client.Disconnect(); return Task.CompletedTask; }, pump, lifetime, TimeSpan.FromSeconds(2));
        foreach (var subscription in subscriptions) subscription.Dispose(); lifetime.Dispose();
    }
}

internal sealed class Transport(Session session, DepotRequest selected) : IDepotTransport
{
    private readonly Client cdn = new(session.Client);
    private byte[]? key; private ulong code; private Server? server; private string? auth; private bool authorized;
    internal long DownloadedBytes;
    private long reportedBytes;
    public async Task Authorize(DepotRequest request, CancellationToken cancellation)
    {
        if (request != selected || !session.Ready || request.App != 1007 || request.Branch != "public") throw new WorkerError("proof_invalid_transport_scope");
        var apps = session.Client.GetHandler<SteamApps>()!; var content = session.Client.GetHandler<SteamContent>()!;
        var reply = await apps.GetDepotDecryptionKey(request.Depot, request.App).ToTask().WaitAsync(cancellation);
        if (reply.Result != EResult.OK || reply.DepotID != request.Depot || reply.DepotKey.Length != 32)
        { CryptographicOperations.ZeroMemory(reply.DepotKey); throw new WorkerError("proof_depot_access_denied"); }
        key = reply.DepotKey;
        code = await content.GetManifestRequestCode(request.Depot, request.App, request.Manifest, "public").WaitAsync(cancellation);
        if (code == 0) throw new WorkerError("proof_manifest_access_denied");
        var servers = await content.GetServersForSteamPipe(maxNumServers: 20).WaitAsync(cancellation);
        Program.Event(PublicCdnPolicy.DirectorySummary(servers, request.App, Program.TransportMode));
        server = servers.FirstOrDefault(s => PublicCdnPolicy.Eligible(s, request.App, Program.TransportMode))
            ?? throw new WorkerError("proof_secure_cdn_missing");
        if (Program.TransportMode == PublicTransportMode.ExplicitPublicCdn)
        {
            PublicCdnPolicy.ExplicitPublic(AccessProofKind.AnonymousPublic, request, server);
            auth = null; // SDK-documented optional CDN token, chosen before any HTTP content attempt.
        }
        else
        {
            var token = await content.GetCDNAuthToken(request.App, request.Depot, server.VHost!).WaitAsync(cancellation);
            Program.Event(new { Stage = "cdn_token_diagnostic", Result = token.Result.ToString(), TokenPresent = !string.IsNullOrEmpty(token.Token),
                ExpirationAfterUnixEpoch = token.Expiration > DateTime.UnixEpoch, ExpirationFuture = token.Expiration > DateTime.UtcNow,
                ServerKind = server.Type is "CDN" or "SteamCache" ? server.Type : "other", Protocol = "https", HostAndVirtualHostEqual = server.Host == server.VHost });
            PublicCdnPolicy.RequireScoped(token.Result, !string.IsNullOrEmpty(token.Token), token.Expiration, DateTime.UtcNow);
            auth = token.Token;
        }
        authorized = true;
        Program.Event(new { Stage = "anonymous_depot_access", App = request.App, Depot = request.Depot, Manifest = new MetadataUInt64(request.Manifest), KeyResult = "OK", RequestCodeGranted = true,
            ServerKind = server.Type is "CDN" or "SteamCache" ? server.Type : "other", Protocol = "https", CdnAuth = Program.TransportMode == PublicTransportMode.ExplicitPublicCdn ? "explicit_public_optional_token" : "scoped_token_ok" });
    }
    public void ValidateAccess(DepotRequest request, CancellationToken cancellation)
    { cancellation.ThrowIfCancellationRequested(); if (!authorized || !session.Ready || request != selected) throw new WorkerError("proof_access_changed"); }
    public async Task<DepotManifest> Manifest(DepotRequest request, CancellationToken cancellation)
    { ValidateAccess(request, cancellation); var manifest = await cdn.DownloadManifestAsync(request.Depot, request.Manifest, code, server!, key, cdnAuthToken: auth); ValidateAccess(request, cancellation); return manifest; }
    public async Task<byte[]> Chunk(DepotRequest request, DepotManifest.ChunkData chunk, CancellationToken cancellation)
    {
        ValidateAccess(request, cancellation);
        if (chunk.UncompressedLength > DepotAcquisition.MaxChunkBytes) throw new WorkerError("proof_chunk_cap_exceeded");
        var bytes = new byte[checked((int)chunk.UncompressedLength)];
        var count = await cdn.DownloadDepotChunkAsync(request.Depot, chunk, server!, bytes, key, cdnAuthToken: auth);
        ValidateAccess(request, cancellation); if (count != bytes.Length) throw new WorkerError("proof_chunk_length_mismatch");
        DownloadedBytes += count;
        if (DownloadedBytes - reportedBytes >= 16 * 1024 * 1024)
        {
            reportedBytes = DownloadedBytes;
            Program.Event(new { Stage = "content_bytes_received", App = request.App, Depot = request.Depot,
                Manifest = new MetadataUInt64(request.Manifest), Bytes = new MetadataUInt64((ulong)DownloadedBytes),
                SdkChunkChecksumChecked = true, FinalFileVerificationPending = true });
        }
        return bytes;
    }
    public ValueTask DisposeAsync() { cdn.Dispose(); if (key is not null) CryptographicOperations.ZeroMemory(key); key = null; auth = null; code = 0; authorized = false; return ValueTask.CompletedTask; }
}
