// MIT. Original package-derived entitlement and exact depot selection.
using SteamKit2;
using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Voltra.SteamPrivate;

internal sealed record ContentSelection(uint App, string Branch, string Platform, string Architecture, string Language, IReadOnlySet<uint> DlcApps);
internal sealed record EntitledPlan(uint App, ulong Build, IReadOnlyList<DepotRequest> Depots, long LicenseRevision);
internal sealed record LicensedPackage(uint Id, ulong Token, ELicenseFlags Flags);
internal sealed record EntitlementInventory(IReadOnlySet<uint> Apps, IReadOnlySet<uint> Depots);

internal static class EntitledSelection
{
    internal static bool Active(ELicenseFlags flags) => (flags & (ELicenseFlags.RenewalFailed | ELicenseFlags.Pending
        | ELicenseFlags.Expired | ELicenseFlags.CancelledByUser | ELicenseFlags.CancelledByAdmin
        | ELicenseFlags.CancelledByFriendlyFraudLock | ELicenseFlags.NotActivated | ELicenseFlags.PendingRefund
        | ELicenseFlags.CancelledByPartner | ELicenseFlags.Borrowed)) == 0;

    internal static EntitlementInventory Inventory(IReadOnlyList<LicensedPackage> licenses, IReadOnlyDictionary<uint, KeyValue> packages)
    {
        if (licenses.Count > 4096 || licenses.Select(l => l.Id).Distinct().Count() != licenses.Count) throw new WorkerError("invalid_license_list");
        var apps = new HashSet<uint>(); var depots = new HashSet<uint>();
        foreach (var license in licenses.Where(l => Active(l.Flags)))
        {
            if (!packages.TryGetValue(license.Id, out var package)) throw new WorkerError("package_access_missing");
            Add(package["appids"], apps); Add(package["depotids"], depots);
        }
        return new(apps, depots);
    }

    private static void Add(KeyValue values, HashSet<uint> target)
    {
        if (values.Children.Count > 65536) throw new WorkerError("package_metadata_too_large");
        foreach (var child in values.Children)
        {
            var number = MetadataUInt64.ParseCanonical(child.Value);
            if (number is null or 0 or > uint.MaxValue) throw new WorkerError("invalid_package_metadata");
            target.Add((uint)number.Value);
        }
    }

    private static bool Matches(KeyValue depot, ContentSelection selection)
    {
        var config = depot["config"];
        var systems = config["oslist"].Value;
        if (!string.IsNullOrEmpty(systems) && !systems.Split(',').Contains(selection.Platform, StringComparer.Ordinal)) return false;
        var arch = config["osarch"].Value;
        if (!string.IsNullOrEmpty(arch) && arch != selection.Architecture) return false;
        var language = config["language"].Value;
        return string.IsNullOrEmpty(language) || language == selection.Language;
    }

    internal static EntitledPlan Select(ContentSelection selection, EntitlementInventory inventory,
        IReadOnlyDictionary<uint, KeyValue> appMetadata, long licenseRevision, IReadOnlyDictionary<string, byte[]>? betaKeys = null)
    {
        if (selection.App == 0 || selection.Platform is not ("linux" or "windows") || selection.Architecture is not ("32" or "64")
            || string.IsNullOrEmpty(selection.Branch) || string.IsNullOrEmpty(selection.Language)) throw new WorkerError("invalid_content_selection");
        if (!inventory.Apps.Contains(selection.App)) throw new WorkerError("app_entitlement_missing");
        if (selection.DlcApps.Any(id => !inventory.Apps.Contains(id))) throw new WorkerError("dlc_entitlement_missing");
        if (!appMetadata.TryGetValue(selection.App, out var app)) throw new WorkerError("app_access_missing");
        var branch = app["depots"]["branches"][selection.Branch];
        var build = MetadataUInt64.ParseCanonical(branch["buildid"].Value);
        if (build is null or 0) throw new WorkerError("requested_branch_missing");
        var selected = new List<DepotRequest>(); var seen = new HashSet<uint>();
        foreach (var depot in app["depots"].Children)
        {
            var id = MetadataUInt64.ParseCanonical(depot.Name);
            if (id is null or 0 or > uint.MaxValue) continue;
            if (!seen.Add((uint)id.Value)) throw new WorkerError("duplicate_depot_metadata");
            if (!Matches(depot, selection)) continue;
            var dlc = MetadataUInt64.ParseCanonical(depot["dlcappid"].Value);
            if (depot["dlcappid"].Value is not null && dlc is null or 0 or > uint.MaxValue) throw new WorkerError("invalid_dlc_metadata");
            if (dlc is not null && !selection.DlcApps.Contains((uint)dlc.Value)) continue;
            selected.Add(Resolve(selection.App, (uint)id.Value, depot, selection, inventory, appMetadata, new HashSet<uint>(), betaKeys));
        }
        if (selected.Count == 0) throw new WorkerError("no_eligible_depots");
        return new(selection.App, build.Value, selected, licenseRevision);
    }

    private static DepotRequest Resolve(uint sourceApp, uint depotId, KeyValue depot, ContentSelection selection,
        EntitlementInventory inventory, IReadOnlyDictionary<uint, KeyValue> apps, HashSet<uint> visited, IReadOnlyDictionary<string, byte[]>? betaKeys)
    {
        if (!visited.Add(sourceApp) || visited.Count > 16) throw new WorkerError("shared_depot_cycle");
        var shared = MetadataUInt64.ParseCanonical(depot["depotfromapp"].Value);
        if (depot["depotfromapp"].Value is not null && shared is null or 0 or > uint.MaxValue) throw new WorkerError("invalid_shared_depot_metadata");
        if (shared is not null)
        {
            if (!inventory.Apps.Contains((uint)shared.Value) && !inventory.Depots.Contains(depotId)) throw new WorkerError("shared_depot_entitlement_missing");
            if (!apps.TryGetValue((uint)shared.Value, out var source)) throw new WorkerError("shared_app_access_missing");
            var found = source["depots"][depotId.ToString(System.Globalization.CultureInfo.InvariantCulture)];
            if (found.Children.Count == 0 || !Matches(found, selection)) throw new WorkerError("shared_depot_platform_mismatch");
            return Resolve((uint)shared.Value, depotId, found, selection, inventory, apps, visited, betaKeys);
        }
        var manifest = depot["manifests"][selection.Branch];
        var gid = MetadataUInt64.ParseCanonical(manifest["gid"].Value ?? manifest.Value);
        if (gid is null or 0)
        {
            var encrypted = depot["encryptedmanifests"][selection.Branch]["gid"].Value;
            if (encrypted is not null)
            {
                if (betaKeys is null || !betaKeys.TryGetValue(selection.Branch, out var key) || key.Length != 32) throw new WorkerError("beta_not_authorized");
                gid = DecryptManifestId(encrypted, key);
            }
            else
            throw new WorkerError("requested_manifest_missing");
        }
        return new(sourceApp, depotId, gid.Value, selection.Branch);
    }

    internal static ulong DecryptManifestId(string encrypted, byte[] key)
    {
        byte[]? ciphertext = null, plaintext = null;
        try
        {
            if (key.Length != 32 || encrypted.Length is < 64 or > 256 || encrypted.Length % 32 != 0) throw new WorkerError("invalid_encrypted_manifest");
            ciphertext = Convert.FromHexString(encrypted);
            plaintext = CryptoHelper.SymmetricDecrypt(ciphertext, key);
            if (plaintext.Length != 8) throw new WorkerError("invalid_encrypted_manifest");
            var gid = BinaryPrimitives.ReadUInt64LittleEndian(plaintext);
            if (gid == 0) throw new WorkerError("invalid_encrypted_manifest");
            return gid;
        }
        catch (WorkerError) { throw; }
        catch { throw new WorkerError("invalid_encrypted_manifest"); }
        finally
        {
            if (ciphertext is not null) CryptographicOperations.ZeroMemory(ciphertext);
            if (plaintext is not null) CryptographicOperations.ZeroMemory(plaintext);
        }
    }
}
