// MIT. Original SteamKit transport policy; account authorization stays upstream.
using System.Net;
using SteamKit2;
using SteamKit2.CDN;

namespace Voltra.SteamPrivate;

internal sealed record CdnAuthorization(uint App, uint Depot, string Host, string? Token, DateTime Expiration)
{
    public override string ToString() => "CdnAuthorization [private]";
    internal static CdnAuthorization FromReply(DepotRequest request, Server server, EResult result, string? token, DateTime expiration, DateTime now)
    {
        // This is a pre-first-request credential decision, not a downgrade after
        // a denied content request. A denied token lookup remains terminal.
        if (result != EResult.OK) throw new WorkerError("cdn_auth_result_denied");
        if (string.IsNullOrEmpty(token)) return new(request.App, request.Depot, server.VHost!, null, DateTime.MinValue);
        if (expiration <= now) throw new WorkerError("cdn_token_expired");
        return new(request.App, request.Depot, server.VHost!, token, expiration);
    }

    internal string? For(DepotRequest request, Server server, DateTime now)
    {
        if (App != request.App || Depot != request.Depot || Host != server.VHost) throw new WorkerError("cdn_token_scope_mismatch");
        if (Token is null)
        {
            if (Expiration != DateTime.MinValue) throw new WorkerError("invalid_cdn_authorization");
            return null;
        }
        if (Token.Length == 0 || Token.Length > 16384 || Token.IndexOfAny(['\r', '\n', '\0']) >= 0) throw new WorkerError("invalid_cdn_authorization");
        if (Expiration <= now) throw new WorkerError("cdn_token_expired");
        return Token;
    }
}

internal static class OfficialCdnPolicy
{
    internal static bool Eligible(Server server, uint app)
        => app != 0 && !server.UseAsProxy && server.Protocol == Server.ConnectionProtocol.HTTPS && server.Port == 443
            && !string.IsNullOrEmpty(server.Host) && !string.IsNullOrEmpty(server.VHost)
            && (server.AllowedAppIds.Length == 0 || server.AllowedAppIds.Contains(app));

    private static void Require(DepotRequest request, Server server, byte[] key, ulong requestCode, Func<bool> entitlementCurrent, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!entitlementCurrent()) throw new WorkerError("entitlement_changed");
        if (request.App == 0 || request.Depot == 0 || request.Manifest == 0 || string.IsNullOrEmpty(request.Branch)
            || key.Length != 32 || requestCode == 0) throw new WorkerError("depot_access_denied");
        if (!Eligible(server, request.App)) throw new WorkerError("secure_cdn_unavailable");
    }

    internal static async Task<DepotManifest> Manifest(Client cdn, DepotRequest request, Server server, byte[] key,
        ulong requestCode, Func<bool> entitlementCurrent, CancellationToken cancellation, CdnAuthorization authorization)
    {
        Require(request, server, key, requestCode, entitlementCurrent, cancellation);
        try
        {
            // SDK-documented optional CDN token. This is the first content HTTP
            // request, after real account/key/request-code checks, never a retry
            // following a denied authenticated request. No endpoint is changed.
            var token = authorization.For(request, server, DateTime.UtcNow);
            var manifest = await cdn.DownloadManifestAsync(request.Depot, request.Manifest, requestCode, server, key, cdnAuthToken: token);
            Require(request, server, key, requestCode, entitlementCurrent, cancellation);
            return manifest;
        }
        catch (HttpRequestException error) when (error.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        { throw new WorkerError("cdn_http_access_denied"); }
    }

    internal static async Task<byte[]> Chunk(Client cdn, DepotRequest request, Server server, byte[] key,
        ulong requestCode, DepotManifest.ChunkData chunk, Func<bool> entitlementCurrent, CancellationToken cancellation, CdnAuthorization authorization)
    {
        Require(request, server, key, requestCode, entitlementCurrent, cancellation);
        if (chunk.UncompressedLength > DepotAcquisition.MaxChunkBytes) throw new WorkerError("chunk_budget_exceeded");
        var bytes = new byte[checked((int)chunk.UncompressedLength)];
        try
        {
            var token = authorization.For(request, server, DateTime.UtcNow);
            var size = await cdn.DownloadDepotChunkAsync(request.Depot, chunk, server, bytes, key, cdnAuthToken: token);
            Require(request, server, key, requestCode, entitlementCurrent, cancellation);
            if (size != bytes.Length) throw new WorkerError("chunk_length_mismatch");
            return bytes;
        }
        catch (HttpRequestException error) when (error.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        { throw new WorkerError("cdn_http_access_denied"); }
    }
}
