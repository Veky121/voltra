// MIT. Actual SteamKit license protobuf and KeyValue structures; no transport.
using System.Reflection;
using ProtoBuf;
using SteamKit2;
using SteamKit2.Internal;
using System.Security.Cryptography;
using System.Buffers.Binary;

namespace Voltra.SteamPrivate;

internal static class EntitledSelectionTests
{
    private static void Check(bool ok) { if (!ok) throw new InvalidOperationException("entitlement fixture"); }
    private static KeyValue Kv(string text) => KeyValue.LoadFromString(text) ?? throw new InvalidOperationException("KeyValue fixture");
    private static void Error(Action action, string code)
    { try { action(); throw new InvalidOperationException("expected rejection"); } catch (WorkerError error) { Check(error.Code == code); } }
    private static LicensedPackage License(ELicenseFlags flags)
    {
        var message = new CMsgClientLicenseList.License { package_id = 77, access_token = ulong.MaxValue, flags = (uint)flags };
        using var stream = new MemoryStream(); Serializer.Serialize(stream, message); stream.Position = 0;
        var decoded = Serializer.Deserialize<CMsgClientLicenseList.License>(stream);
        var constructor = typeof(SteamApps.LicenseListCallback.License).GetConstructor(BindingFlags.Instance | BindingFlags.NonPublic,
            null, [typeof(CMsgClientLicenseList.License)], null)!;
        var license = (SteamApps.LicenseListCallback.License)constructor.Invoke([decoded]);
        return new(license.PackageID, license.AccessToken, license.LicenseFlags);
    }
    internal static Task Run()
    {
        var packages = new Dictionary<uint, KeyValue> { [77] = Kv("\"77\" { \"appids\" { \"0\" \"42\" \"1\" \"900\" \"2\" \"901\" } \"depotids\" { \"0\" \"100\" } }") };
        var inventory = EntitledSelection.Inventory([License(ELicenseFlags.None)], packages);
        Check(inventory.Apps.SetEquals(new uint[] { 42, 900, 901 }) && inventory.Depots.Contains(100));
        var expired = EntitledSelection.Inventory([License(ELicenseFlags.Expired)], packages);
        Check(expired.Apps.Count == 0);
        foreach (var flag in new[] { ELicenseFlags.Pending, ELicenseFlags.PendingRefund, ELicenseFlags.Borrowed, ELicenseFlags.CancelledByPartner })
            Check(!EntitledSelection.Active(flag));
        Error(() => EntitledSelection.Inventory([License(ELicenseFlags.None)], new Dictionary<uint, KeyValue>()), "package_access_missing");
        var text = "\"appinfo\" { \"depots\" { \"branches\" { \"preview\" { \"buildid\" \"18446744073709551615\" } } "
            + "\"100\" { \"config\" { \"oslist\" \"linux\" \"osarch\" \"64\" \"language\" \"english\" } \"manifests\" { \"preview\" { \"gid\" \"18446744073709551615\" } } } "
            + "\"101\" { \"config\" { \"oslist\" \"windows\" } \"manifests\" { \"preview\" { \"gid\" \"2\" } } } "
            + "\"102\" { \"dlcappid\" \"901\" \"manifests\" { \"preview\" { \"gid\" \"3\" } } } } }";
        var apps = new Dictionary<uint, KeyValue> { [42] = Kv(text) };
        var selection = new ContentSelection(42, "preview", "linux", "64", "english", new HashSet<uint>());
        var plan = EntitledSelection.Select(selection, inventory, apps, 7);
        Check(plan.Build == ulong.MaxValue && plan.Depots.Count == 1 && plan.Depots[0].Manifest == ulong.MaxValue && plan.LicenseRevision == 7);
        plan = EntitledSelection.Select(selection with { DlcApps = new HashSet<uint> { 901 } }, inventory, apps, 8);
        Check(plan.Depots.Count == 2);
        Error(() => EntitledSelection.Select(selection, expired, apps, 9), "app_entitlement_missing");
        Error(() => EntitledSelection.Select(selection with { Branch = "public" }, inventory, apps, 9), "requested_branch_missing");
        Error(() => EntitledSelection.Select(selection with { DlcApps = new HashSet<uint> { 999 } }, inventory, apps, 9), "dlc_entitlement_missing");
        Error(() => EntitledSelection.Select(selection with { Architecture = "32" }, inventory, new Dictionary<uint, KeyValue> { [42] = Kv(text.Replace("\"dlcappid\" \"901\"", "\"config\" { \"osarch\" \"64\" } \"dlcappid\" \"901\"")) }, 9), "no_eligible_depots");
        apps[42] = Kv("\"appinfo\" { \"depots\" { \"branches\" { \"preview\" { \"buildid\" \"1\" } } \"100\" { \"depotfromapp\" \"900\" } } }");
        apps[900] = Kv("\"appinfo\" { \"depots\" { \"100\" { \"config\" { \"oslist\" \"linux\" } \"manifests\" { \"preview\" { \"gid\" \"5\" } } } } }");
        plan = EntitledSelection.Select(selection, inventory, apps, 10);
        Check(plan.Depots.Single() == new DepotRequest(900, 100, 5, "preview"));
        Error(() => EntitledSelection.Select(selection, new EntitlementInventory(new HashSet<uint> { 42 }, new HashSet<uint>()), apps, 10), "shared_depot_entitlement_missing");
        apps[900] = Kv("\"appinfo\" { \"depots\" { \"100\" { \"depotfromapp\" \"42\" } } }");
        Error(() => EntitledSelection.Select(selection, inventory, apps, 11), "shared_depot_cycle");
        apps[42] = Kv("\"appinfo\" { \"depots\" { \"branches\" { \"preview\" { \"buildid\" \"1\" \"pwdrequired\" \"1\" } } \"100\" { \"encryptedmanifests\" { \"preview\" { \"gid\" \"ciphertext\" } } } } }");
        Error(() => EntitledSelection.Select(selection, inventory, apps, 12), "beta_not_authorized");
        var key = Enumerable.Range(0, 32).Select(i => (byte)i).ToArray();
        var plaintext = new byte[8]; BinaryPrimitives.WriteUInt64LittleEndian(plaintext, ulong.MaxValue);
        var iv = Enumerable.Range(1, 16).Select(i => (byte)i).ToArray();
        using var aes = Aes.Create(); aes.Key = key;
        var encrypted = Convert.ToHexString(aes.EncryptEcb(iv, PaddingMode.None).Concat(aes.EncryptCbc(plaintext, iv, PaddingMode.PKCS7)).ToArray());
        Check(EntitledSelection.DecryptManifestId(encrypted, key) == ulong.MaxValue);
        apps[42] = Kv("\"appinfo\" { \"depots\" { \"branches\" { \"preview\" { \"buildid\" \"1\" \"pwdrequired\" \"1\" } } \"100\" { \"encryptedmanifests\" { \"preview\" { \"gid\" \"" + encrypted + "\" } } } } }");
        Check(EntitledSelection.Select(selection, inventory, apps, 12, new Dictionary<string, byte[]> { ["preview"] = key }).Depots.Single().Manifest == ulong.MaxValue);
        Error(() => EntitledSelection.DecryptManifestId(encrypted, new byte[32]), "invalid_encrypted_manifest");
        Error(() => EntitledSelection.DecryptManifestId("invalid", key), "invalid_encrypted_manifest");
        return Task.CompletedTask;
    }
}
