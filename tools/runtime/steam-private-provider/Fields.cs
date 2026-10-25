// MIT. Source-only worker fork; see upstream license and CONTRACT.md.
using System.Text;
using ProtoBuf;
using SteamKit2.Authentication;
using SteamKit2.Internal;

namespace Voltra.SteamPrivate;

internal sealed class WorkerError(string code) : Exception(code)
{
    public string Code { get; } = code;
}

internal sealed record PrivateRequest(string Operation, string? Username, string? Password,
    string? Guard, string Branch, string? BetaPassword, uint AppId, bool ParentFieldsValidated)
{
    public override string ToString() => "PrivateRequest [private]";
}

internal static class TypedFields
{
    internal static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public static void Validate(PrivateRequest request)
    {
        if (request.Operation is not ("prepare_only" or "authenticate_beta" or "anonymous_metadata") || !request.ParentFieldsValidated || request.AppId == 0 || request.AppId > int.MaxValue)
            throw new WorkerError("invalid_request");
        // Parent owns every original account/password/Guard field policy. No
        // trimming, character restriction or replacement limit is invented here.
        foreach (var value in new[] { request.Username, request.Password, request.Guard })
            if (value is not null) _ = StrictUtf8.GetByteCount(value);
        if (!System.Text.RegularExpressions.Regex.IsMatch(request.Branch, "\\A[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\\z"))
            throw new WorkerError("invalid_request");
        ValidateBeta(request.BetaPassword, request.Branch);
    }

    public static void ValidateBeta(string? value, string branch)
    {
        if (value is null) return;
        if (StrictUtf8.GetByteCount(value) > 1024 || value.IndexOfAny(['\r', '\n', '\0']) >= 0 || value.Length > 0 && branch == "public")
            throw new WorkerError("invalid_beta_field");
    }

    public static AuthSessionDetails Authentication(PrivateRequest request, IAuthenticator authenticator)
    {
        Validate(request);
        return new AuthSessionDetails { Username = request.Username, Password = request.Password,
            Authenticator = authenticator, IsPersistentSession = false, GuardData = null,
            DeviceFriendlyName = "Voltra private worker", WebsiteID = "Client" };
    }

    public static CMsgClientCheckAppBetaPassword BetaPacket(uint appId, string? password, string branch)
    {
        ValidateBeta(password, branch);
        return new CMsgClientCheckAppBetaPassword { app_id = appId, betapassword = password ?? "" };
    }

    public static byte[] SerializeBeta(CMsgClientCheckAppBetaPassword packet)
    {
        using var memory = new MemoryStream(); Serializer.Serialize(memory, packet); return memory.ToArray();
    }
}
