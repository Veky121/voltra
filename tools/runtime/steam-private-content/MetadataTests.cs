// MIT. Actual SteamKit protobuf/PICS KeyValue parser plus injected offline flow.
using System.Reflection;
using System.Text;
using ProtoBuf;
using SteamKit2;
using SteamKit2.Internal;

namespace Voltra.SteamPrivate;

internal static class MetadataTests
{
    private static void Check(bool ok) { if (!ok) throw new InvalidOperationException("metadata fixture"); }
    private static SteamApps.PICSProductInfoCallback.PICSProductInfo Wire(string text, bool missing = false)
    {
        var message = new CMsgClientPICSProductInfoResponse();
        message.apps.Add(new CMsgClientPICSProductInfoResponse.AppInfo { appid = 42, change_number = 123,
            missing_token = missing, only_public = true, buffer = Encoding.UTF8.GetBytes(text + "\0") });
        using var stream = new MemoryStream(); Serializer.Serialize(stream, message); stream.Position = 0;
        var decoded = Serializer.Deserialize<CMsgClientPICSProductInfoResponse>(stream);
        // Invoke actual package parser, not a local copy or mocked protobuf.
        var constructor = typeof(SteamApps.PICSProductInfoCallback.PICSProductInfo).GetConstructor(BindingFlags.NonPublic | BindingFlags.Instance,
            null, [typeof(CMsgClientPICSProductInfoResponse), typeof(CMsgClientPICSProductInfoResponse.AppInfo)], null)!;
        return (SteamApps.PICSProductInfoCallback.PICSProductInfo)constructor.Invoke([decoded, decoded.apps[0]]);
    }
    private const string Text = "\"appinfo\" { \"appid\" \"42\" \"common\" { \"oslist\" \"windows,linux\" } \"depots\" { \"branches\" { \"public\" { \"buildid\" \"123456\" } \"preview\" { \"buildid\" \"234567\" \"pwdrequired\" \"1\" } } \"100\" { \"config\" { \"oslist\" \"linux\" \"osarch\" \"64\" } \"manifests\" { \"public\" { \"gid\" \"18446744073709551615\" \"size\" \"5000000000\" \"download\" \"2000000000\" } } \"encryptedmanifests\" { \"preview\" { \"encrypted_gid\" \"DO_NOT_PUBLISH\" } } } \"101\" { \"depotfromapp\" \"900\" \"manifests\" { \"public\" \"456\" } } } }";
    public static Task ActualWire()
    {
        var result = MetadataProjection.Project(42, Wire(Text));
        Check(result.State == "available" && result.AppId == 42 && result.ChangeNumber == 123 && result.OnlyPublic);
        Check(!result.EntitlementVerified && !result.ContentDownloaded && result.Platforms.SequenceEqual(new[] { "linux", "windows" }));
        Check(result.Branches.Single(b => b.Name == "preview").PasswordRequired && result.Branches[0].BuildId == 123456);
        var depot = result.Depots.Single(d => d.DepotId == 100); var manifest = depot.Manifests.Single();
        Check(depot.Platforms.Single() == "linux" && depot.Architecture == 64 && depot.EncryptedManifestsPresent);
        Check(manifest.ManifestId == ulong.MaxValue && manifest.DiskBytes == 5000000000 && manifest.DownloadBytes == 2000000000);
        Check(result.Depots[1].FromAppId == 900 && result.Depots[1].Manifests[0].DiskBytes is null);
        Check(!System.Text.Json.JsonSerializer.Serialize(result).Contains("DO_NOT_PUBLISH"));
        Check(MetadataProjection.Project(42, Wire(Text, true)).State == "missing_access");
        Check(MetadataProjection.Project(42, Wire("\"appinfo\" { \"appid\" \"42\" }")).State == "empty");
        Check(MetadataProjection.Project(42, Wire(Text.Replace("18446744073709551615", "18446744073709551616"))).State == "partial");
        var badBuild = MetadataProjection.Project(42, Wire(Text.Replace("123456", "0123456")));
        Check(badBuild.State == "partial" && badBuild.Branches[0].BuildId is null);
        var badSize = MetadataProjection.Project(42, Wire(Text.Replace("5000000000", "05000000000")));
        Check(badSize.State == "partial" && badSize.Depots[0].Manifests[0].DiskBytes is null);
        Check(MetadataProjection.Project(42, Wire(Text.Replace("18446744073709551615", "018446744073709551615"))).State == "partial");
        return Task.CompletedTask;
    }
    public static Task Bounds()
    {
        foreach (var (text, error) in new[] {
            (Text.Replace("\"appid\" \"42\"", "\"appid\" \"43\""), "invalid_metadata"),
            ("\"appinfo\" { \"depots\" { \"branches\" { " + string.Join(" ", Enumerable.Range(0, 65).Select(i => $"\"b{i}\" {{ \"buildid\" \"1\" }}")) + " } } }", "metadata_too_large"),
            ("\"appinfo\" { \"depots\" { \"branches\" { \"public\" {} \"public\" {} } } }", "invalid_metadata") })
        {
            try { MetadataProjection.Project(42, Wire(text)); throw new InvalidOperationException(); }
            catch (WorkerError actual) { Check(actual.Code == error); }
        }
        return Task.CompletedTask;
    }
    private sealed class Session : IAnonymousMetadataSession
    {
        public readonly List<string> Calls = [];
        public bool Block, Fail;
        public Task Connect(CancellationToken token) { Calls.Add("connect"); if (Fail) throw new Exception("private publisher exception"); return Task.CompletedTask; }
        public async Task LogOnAnonymous(CancellationToken token) { Calls.Add("anonymous"); if (Block) await Task.Delay(Timeout.Infinite, token); }
        public Task<AppMetadata> ReadAppMetadata(uint appId, CancellationToken token) { Calls.Add("pics"); return Task.FromResult(MetadataProjection.Empty(appId, "unknown")); }
        public ValueTask DisposeAsync() { Calls.Add("dispose"); return ValueTask.CompletedTask; }
    }
    public static async Task State()
    {
        var request = new PrivateRequest("anonymous_metadata", null, null, null, "public", null, 42, true);
        var session = new Session(); var result = await MetadataOperation.Run(request, () => session, CancellationToken.None);
        Check(result.State == "unknown" && !result.EntitlementVerified && session.Calls.SequenceEqual(new[] { "connect", "anonymous", "pics", "dispose" }));
        var created = false;
        foreach (var bad in new[] { request with { Operation = "prepare_only" }, request with { Password = "literal" }, request with { Username = "" }, request with { Guard = "literal" }, request with { BetaPassword = "" }, request with { AppId = 0 } })
        {
            try { await MetadataOperation.Run(bad, () => { created = true; return new Session(); }, CancellationToken.None); throw new InvalidOperationException(); }
            catch (WorkerError) { Check(!created); }
        }
        session = new Session { Fail = true };
        try { await MetadataOperation.Run(request, () => session, CancellationToken.None); throw new InvalidOperationException(); }
        catch (WorkerError error) { Check(error.Code == "metadata_failed" && session.Calls.Last() == "dispose"); }
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(30)); session = new Session { Block = true };
        try { await MetadataOperation.Run(request, () => session, cancel.Token); throw new InvalidOperationException(); }
        catch (OperationCanceledException) { Check(session.Calls.SequenceEqual(new[] { "connect", "anonymous", "dispose" })); }
        created = false;
        try { await MetadataOperation.Run(request, () => { created = true; return new Session(); }, cancel.Token); throw new InvalidOperationException(); }
        catch (OperationCanceledException) { Check(!created); }
    }

    public static async Task Teardown()
    {
        using var lifetime = new CancellationTokenSource(); var disconnected = false;
        await SessionTeardown.Run(() => { disconnected = true; return Task.CompletedTask; }, Task.CompletedTask, lifetime, TimeSpan.FromSeconds(1));
        Check(lifetime.IsCancellationRequested && disconnected);
        using var blocked = new CancellationTokenSource(); var pending = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        try { await SessionTeardown.Run(() => Task.CompletedTask, pending.Task, blocked, TimeSpan.FromMilliseconds(30)); throw new InvalidOperationException(); }
        catch (WorkerError error) { Check(error.Code == "session_teardown_timeout" && blocked.IsCancellationRequested); }
        finally { pending.TrySetResult(); }
        using var failed = new CancellationTokenSource();
        try { await SessionTeardown.Run(() => throw new Exception("do not emit private details"), Task.CompletedTask, failed, TimeSpan.FromSeconds(1)); throw new InvalidOperationException(); }
        catch (WorkerError error) { Check(error.Code == "session_teardown_failed" && failed.IsCancellationRequested); }
    }
}
