// MIT. Explicit public-only transport choice; never a retry after HTTP denial.
using SteamKit2;
using SteamKit2.CDN;
using Voltra.SteamPrivate;

namespace ApprovedAnonymousProof;

internal enum PublicTransportMode { RequireScopedToken, ExplicitPublicCdn }

internal static class PublicCdnPolicy
{
    internal static bool Eligible(Server server, uint app, PublicTransportMode mode)
        => app == 1007 && !server.UseAsProxy && server.Protocol == Server.ConnectionProtocol.HTTPS && server.Port == 443
            && !string.IsNullOrEmpty(server.Host) && !string.IsNullOrEmpty(server.VHost)
            && (server.AllowedAppIds.Length == 0 || server.AllowedAppIds.Contains(app));

    internal static object DirectorySummary(IReadOnlyCollection<Server> servers, uint app, PublicTransportMode mode)
        => new
        {
            Stage = "official_directory_summary", Total = servers.Count,
            Https = servers.Count(s => s.Protocol == Server.ConnectionProtocol.HTTPS), Port443 = servers.Count(s => s.Port == 443),
            NonProxy = servers.Count(s => !s.UseAsProxy), AppAllowed = servers.Count(s => s.AllowedAppIds.Length == 0 || s.AllowedAppIds.Contains(app)),
            HostPresent = servers.Count(s => !string.IsNullOrEmpty(s.Host)), VirtualHostPresent = servers.Count(s => !string.IsNullOrEmpty(s.VHost)),
            Eligible = servers.Count(s => Eligible(s, app, mode)),
            Groups = servers.GroupBy(s => new { Kind = s.Type is "CDN" or "SteamCache" or "CS" ? s.Type : "other",
                Protocol = s.Protocol == Server.ConnectionProtocol.HTTPS ? "https" : "http", Port443 = s.Port == 443, Proxy = s.UseAsProxy,
                AppAllowed = s.AllowedAppIds.Length == 0 || s.AllowedAppIds.Contains(app), HostPresent = !string.IsNullOrEmpty(s.Host), VirtualHostPresent = !string.IsNullOrEmpty(s.VHost) })
                .Select(g => new { g.Key.Kind, g.Key.Protocol, g.Key.Port443, g.Key.Proxy, g.Key.AppAllowed, g.Key.HostPresent, g.Key.VirtualHostPresent, Count = g.Count() })
        };

    internal static void RequireScoped(EResult result, bool tokenPresent, DateTime expiration, DateTime now)
    {
        if (result != EResult.OK) throw new WorkerError("proof_cdn_result_not_ok");
        if (!tokenPresent) throw new WorkerError("proof_cdn_token_missing");
        if (expiration <= DateTime.UnixEpoch) throw new WorkerError("proof_cdn_expiration_absent_or_zero");
        if (expiration <= now) throw new WorkerError("proof_cdn_token_expired");
    }

    internal static void ExplicitPublic(AccessProofKind proof, DepotRequest request, Server server)
    {
        if (proof != AccessProofKind.AnonymousPublic || request.App != 1007 || request.Branch != "public"
            || !Eligible(server, request.App, PublicTransportMode.ExplicitPublicCdn))
            throw new WorkerError("proof_public_cdn_scope_invalid");
    }

    internal static void Guards()
    {
        void Deny(Action action, string code)
        {
            try { action(); throw new InvalidOperationException("expected CDN policy rejection"); }
            catch (WorkerError error) { if (error.Code != code) throw; }
        }
        var now = DateTime.UtcNow;
        RequireScoped(EResult.OK, true, now.AddMinutes(5), now);
        Deny(() => RequireScoped(EResult.AccessDenied, true, now.AddMinutes(5), now), "proof_cdn_result_not_ok");
        Deny(() => RequireScoped(EResult.OK, false, now.AddMinutes(5), now), "proof_cdn_token_missing");
        Deny(() => RequireScoped(EResult.OK, true, DateTime.UnixEpoch, now), "proof_cdn_expiration_absent_or_zero");
        Deny(() => RequireScoped(EResult.OK, true, now.AddSeconds(-1), now), "proof_cdn_token_expired");
        var response = new SteamKit2.Internal.CContentServerDirectory_GetCDNAuthToken_Response();
        if (response.expiration_time != 0 || response.ShouldSerializeexpiration_time() || DateUtils.DateTimeFromUnixTime(response.expiration_time) != DateTime.UnixEpoch)
            throw new InvalidOperationException("actual protobuf expiration default");
        response.expiration_time = 0;
        if (!response.ShouldSerializeexpiration_time()) throw new InvalidOperationException("actual protobuf explicit zero");
        var server = (Server)new System.Net.DnsEndPoint("offline-fixture.invalid", 443);
        typeof(Server).GetProperty(nameof(Server.Type))!.SetValue(server, "CDN");
        ExplicitPublic(AccessProofKind.AnonymousPublic, new(1007, 1006, 1, "public"), server);
        Deny(() => ExplicitPublic(AccessProofKind.PrivateAccount, new(1007, 1006, 1, "public"), server), "proof_public_cdn_scope_invalid");
        Deny(() => ExplicitPublic(AccessProofKind.AnonymousPublic, new(1007, 1006, 1, "preview"), server), "proof_public_cdn_scope_invalid");
        typeof(Server).GetProperty(nameof(Server.Type))!.SetValue(server, "SteamCache");
        ExplicitPublic(AccessProofKind.AnonymousPublic, new(1007, 1006, 1, "public"), server);
        typeof(Server).GetProperty(nameof(Server.Type))!.SetValue(server, "other");
        ExplicitPublic(AccessProofKind.AnonymousPublic, new(1007, 1006, 1, "public"), server);
        typeof(Server).GetProperty(nameof(Server.UseAsProxy))!.SetValue(server, true);
        Deny(() => ExplicitPublic(AccessProofKind.AnonymousPublic, new(1007, 1006, 1, "public"), server), "proof_public_cdn_scope_invalid");
        typeof(Server).GetProperty(nameof(Server.UseAsProxy))!.SetValue(server, false);
        typeof(Server).GetProperty(nameof(Server.AllowedAppIds))!.SetValue(server, new uint[] { 999 });
        Deny(() => ExplicitPublic(AccessProofKind.AnonymousPublic, new(1007, 1006, 1, "public"), server), "proof_public_cdn_scope_invalid");
        server = (Server)new System.Net.DnsEndPoint("offline-fixture.invalid", 80);
        Deny(() => ExplicitPublic(AccessProofKind.AnonymousPublic, new(1007, 1006, 1, "public"), server), "proof_public_cdn_scope_invalid");
    }
}
