// MIT. Actual SteamKit HTTP/ZIP/protobuf/AES chunk code with an offline handler.
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using SteamKit2;
using SteamKit2.CDN;

namespace Voltra.SteamPrivate;

internal static class OfficialCdnPolicyTests
{
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("official CDN fixture"); }
    private static readonly DepotRequest Request = new(42, 43, ulong.MaxValue, "preview");
    private sealed class Handler(byte[] manifest, byte[] chunk) : HttpMessageHandler
    {
        internal int Requests;
        internal HttpStatusCode? Deny;
        internal string Query = "";
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
        {
            Requests++;
            Check(request.RequestUri is { Scheme: "https", Host: "offline-fixture.invalid", Port: 443 } && request.RequestUri.Query == Query
                && request.Headers.Authorization is null);
            if (Deny is not null) return Task.FromResult(new HttpResponseMessage(Deny.Value) { Content = new ByteArrayContent([]) });
            var isManifest = request.RequestUri!.AbsolutePath == "/depot/43/manifest/18446744073709551615/5/7";
            Check(isManifest || request.RequestUri.AbsolutePath.StartsWith("/depot/43/chunk/", StringComparison.Ordinal));
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(isManifest ? manifest : chunk) });
        }
    }
    private static byte[] Zip(string name, byte[] bytes)
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true))
        using (var entry = zip.CreateEntry(name, CompressionLevel.Optimal).Open()) entry.Write(bytes);
        return stream.ToArray();
    }
    private static async Task Error(Func<Task> action, string code)
    { try { await action(); throw new InvalidOperationException("expected rejection"); } catch (WorkerError error) { Check(error.Code == code); } }
    internal static async Task Run()
    {
        var bytes = "original offline actual SteamKit CDN transport fixture bytes"u8.ToArray();
        var key = Enumerable.Range(0, 32).Select(i => (byte)i).ToArray();
        var iv = Enumerable.Range(1, 16).Select(i => (byte)i).ToArray();
        using var aes = Aes.Create(); aes.Key = key;
        var encrypted = aes.EncryptEcb(iv, PaddingMode.None).Concat(aes.EncryptCbc(Zip("chunk", bytes), iv, PaddingMode.PKCS7)).ToArray();
        var chunk = new DepotManifest.ChunkData(SHA1.HashData(bytes), DepotChunk.AdlerHash(bytes), 0, (uint)encrypted.Length, (uint)bytes.Length);
        var publisher = new DepotManifest { DepotID = 43, ManifestGID = ulong.MaxValue, CreationTime = DateTime.UtcNow,
            TotalUncompressedSize = (ulong)bytes.Length, TotalCompressedSize = (ulong)encrypted.Length,
            Files = [new() { FileName = "bin/server", TotalSize = (ulong)bytes.Length, FileHash = SHA1.HashData(bytes), Chunks = [chunk], Flags = EDepotFileFlag.Executable }] };
        using var serialized = new MemoryStream(); publisher.Serialize(serialized);
        var handler = new Handler(Zip("manifest", serialized.ToArray()), encrypted);
        var client = new SteamClient(SteamConfiguration.Create(builder => builder.WithHttpClientFactory(_ => new HttpClient(handler, disposeHandler: false))));
        using var cdn = new Client(client);
        var server = (Server)new DnsEndPoint("offline-fixture.invalid", 443);
        typeof(Server).GetProperty(nameof(Server.Type))!.SetValue(server, "SteamCache");
        var optional = CdnAuthorization.FromReply(Request, server, EResult.OK, "", DateTime.UnixEpoch, DateTime.UtcNow);
        Check(OfficialCdnPolicy.Eligible(server, Request.App));
        await Error(() => OfficialCdnPolicy.Manifest(cdn, Request, server, key, 7, () => false, default, optional), "entitlement_changed");
        await Error(() => OfficialCdnPolicy.Manifest(cdn, Request, server, key, 0, () => true, default, optional), "depot_access_denied");
        await Error(() => OfficialCdnPolicy.Manifest(cdn, Request, server, new byte[31], 7, () => true, default, optional), "depot_access_denied");
        Check(handler.Requests == 0);
        await Error(() => { _ = new SteamKitDepotTransport(client, Request, () => true); return Task.CompletedTask; }, "authenticated_session_required");
        Check(handler.Requests == 0); // HTTP helper never replaces the real account-session gate.
        var manifest = await OfficialCdnPolicy.Manifest(cdn, Request, server, key, 7, () => true, default, optional);
        Check(manifest.DepotID == 43 && manifest.ManifestGID == ulong.MaxValue && DepotAcquisition.Preflight(Request, manifest, 4096).Count == 1);
        var actual = await OfficialCdnPolicy.Chunk(cdn, Request, server, key, 7, manifest.Files![0].Chunks[0], () => true, default, optional);
        Check(actual.SequenceEqual(bytes) && handler.Requests == 2);
        DepotAcquisition.VerifyChunk(manifest.Files[0].Chunks[0], actual);
        var credential = CdnAuthorization.FromReply(Request, server, EResult.OK, "offline_fixture_auth=opaque", DateTime.UtcNow.AddMinutes(5), DateTime.UtcNow);
        Check(!credential.ToString().Contains("opaque", StringComparison.Ordinal));
        handler.Query = "?offline_fixture_auth=opaque";
        _ = await OfficialCdnPolicy.Manifest(cdn, Request, server, key, 7, () => true, default, credential);
        Check((await OfficialCdnPolicy.Chunk(cdn, Request, server, key, 7, chunk, () => true, default, credential)).SequenceEqual(bytes));
        var beforeInvalid = handler.Requests;
        foreach (var invalid in new[] { credential with { App = 999 }, credential with { Depot = 999 }, credential with { Host = "different.invalid" } })
            await Error(() => OfficialCdnPolicy.Manifest(cdn, Request, server, key, 7, () => true, default, invalid), "cdn_token_scope_mismatch");
        await Error(() => OfficialCdnPolicy.Manifest(cdn, Request, server, key, 7, () => true, default, credential with { Expiration = DateTime.UnixEpoch }), "cdn_token_expired");
        await Error(() => { _ = CdnAuthorization.FromReply(Request, server, EResult.AccessDenied, "", DateTime.UnixEpoch, DateTime.UtcNow); return Task.CompletedTask; }, "cdn_auth_result_denied");
        Check(handler.Requests == beforeInvalid);
        foreach (var status in new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden })
        {
            handler.Deny = status; var before = handler.Requests;
            await Error(() => OfficialCdnPolicy.Manifest(cdn, Request, server, key, 7, () => true, default, credential), "cdn_http_access_denied");
            Check(handler.Requests == before + 1);
            before = handler.Requests;
            await Error(() => OfficialCdnPolicy.Chunk(cdn, Request, server, key, 7, chunk, () => true, default, credential), "cdn_http_access_denied");
            Check(handler.Requests == before + 1); // No token retry, alternate endpoint, server or anonymous fallback.
        }
        typeof(Server).GetProperty(nameof(Server.Type))!.SetValue(server, "other");
        Check(OfficialCdnPolicy.Eligible(server, Request.App));
        typeof(Server).GetProperty(nameof(Server.AllowedAppIds))!.SetValue(server, new uint[] { 999 });
        Check(!OfficialCdnPolicy.Eligible(server, Request.App));
        typeof(Server).GetProperty(nameof(Server.AllowedAppIds))!.SetValue(server, new uint[] { 42 });
        typeof(Server).GetProperty(nameof(Server.UseAsProxy))!.SetValue(server, true);
        Check(!OfficialCdnPolicy.Eligible(server, Request.App));
        Check(!OfficialCdnPolicy.Eligible((Server)new DnsEndPoint("offline-fixture.invalid", 80), Request.App));
        CryptographicOperations.ZeroMemory(key);
    }
}
