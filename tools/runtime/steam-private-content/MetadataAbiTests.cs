// MIT. Public JSON decimal-string identity regression, no Steam connections.
using System.Text.Json;
using System.Runtime.InteropServices;

namespace Voltra.SteamPrivate;

internal static class MetadataAbiTests
{
    [DllImport("libc", SetLastError = true)] private static extern int pipe([Out] int[] descriptors);
    [DllImport("libc", SetLastError = true)] private static extern int close(int descriptor);
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private static void Check(bool ok) { if (!ok) throw new InvalidOperationException("metadata ABI fixture"); }
    public static AppMetadata Fixture() => new(3809400, "fixture", false, false, 39599309, ["windows"],
        [new("public", new MetadataUInt64(25642172), false)],
        [new(3809401, null, ["windows"], 64, false,
            [new("public", new MetadataUInt64(3659990775896995763), new MetadataUInt64(21349240119), new MetadataUInt64(2653127216))])]);
    public static Task Canonical()
    {
        foreach (var number in new[] { 0UL, 1UL, 9007199254740991UL, 9007199254740992UL, 3659990775896995763UL, ulong.MaxValue })
        {
            var value = new MetadataUInt64(number); var raw = JsonSerializer.Serialize(value);
            Check(raw == "\"" + number.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\"");
            Check(JsonSerializer.Deserialize<MetadataUInt64>(raw).Value == number);
        }
        foreach (var bad in new[] { "\"\"", "\"01\"", "\" 1\"", "\"1 \"", "\"+1\"", "\"-1\"", "\"1.0\"", "\"1e3\"", "\"18446744073709551616\"", "\"١\"", "3659990775896995763", "1.0", "null", "true" })
        {
            try { JsonSerializer.Deserialize<MetadataUInt64>(bad); throw new InvalidOperationException("expected strict string rejection"); }
            catch (JsonException) { }
        }
        foreach (var value in new[] { "", "01", "+1", " 1", "1 ", "-1", "1e2", "18446744073709551616" }) Check(MetadataUInt64.ParseCanonical(value) is null);
        var payload = JsonSerializer.Serialize(Fixture(), Json);
        using var parsed = JsonDocument.Parse(payload);
        Check(parsed.RootElement.GetProperty("branches")[0].GetProperty("build_id").GetString() == "25642172");
        var manifest = parsed.RootElement.GetProperty("depots")[0].GetProperty("manifests")[0];
        Check(manifest.GetProperty("manifest_id").GetString() == "3659990775896995763");
        Check(manifest.GetProperty("disk_bytes").GetString() == "21349240119" && manifest.GetProperty("download_bytes").GetString() == "2653127216");
        Check(JsonSerializer.Deserialize<AppMetadata>(payload, Json)!.Depots[0].Manifests[0].ManifestId.Value == 3659990775896995763UL);
        return Task.CompletedTask;
    }
    public static async Task PrivateFrame()
    {
        var incoming = new int[2]; var outgoing = new int[2];
        Check(pipe(incoming) == 0 && pipe(outgoing) == 0);
        try
        {
            using var worker = new FdMessages(incoming[0], outgoing[1]);
            using var parent = new FdMessages(outgoing[0], incoming[1]);
            var receive = parent.ReceiveAsync<AppMetadata>(CancellationToken.None);
            await worker.SendAsync(Fixture(), CancellationToken.None);
            Check((await receive).Depots[0].Manifests[0].ManifestId.Value == 3659990775896995763UL);
        }
        finally { foreach (var fd in incoming.Concat(outgoing)) _ = close(fd); }
    }
}
