// MIT. Anchored bounded operator inventory. Never adopts these bytes as publisher content.
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

namespace Voltra.SteamPrivate;

internal sealed record OperatorEntry(string Path, bool Directory, string? Sha256, MetadataUInt64 Bytes,
    uint Mode, uint Uid, uint Gid, MetadataUInt64 Device, MetadataUInt64 Inode);
internal sealed record StorageEntryIdentity(MetadataUInt64 Device, MetadataUInt64 Inode, uint Mode, uint Uid, uint Gid);

internal sealed partial class PrivateDirectory
{
    private byte[] ValidateMutableDirectory(int fd)
    {
        var stat = new byte[144];
        if (fstat(fd, stat) != 0 || (BitConverter.ToUInt32(stat, 24) & 0xf000) != 0x4000 || BitConverter.ToUInt64(stat, 0) != Device)
            throw new WorkerError("unsafe_operator_entry");
        return stat; // Owner/mode are operator observations, never immutable admission grants.
    }
    private static void CheckCaseName(SafeFileHandle parent, string expected)
    {
        var fd = openat(checked((int)parent.DangerousGetHandle()), ".", DirectoryFlag | NoFollow | CloseExec, 0);
        if (fd < 0) throw new WorkerError("operator_inventory_failed");
        var dir = fdopendir(fd);
        if (dir == IntPtr.Zero) { _ = close(fd); throw new WorkerError("operator_inventory_failed"); }
        try
        {
            var count = 0;
            while (true)
            {
                Marshal.WriteInt32(__errno_location(), 0); var entry = readdir(dir);
                if (entry == IntPtr.Zero) { if (Marshal.GetLastPInvokeError() != 0) throw new WorkerError("operator_inventory_failed"); break; }
                if (++count > 100000) throw new WorkerError("operator_inventory_limit");
                var name = Marshal.PtrToStringUTF8(entry + 19) ?? throw new WorkerError("operator_inventory_failed");
                if (name != expected && name.Equals(expected, StringComparison.OrdinalIgnoreCase)) throw new WorkerError("operator_casefold_collision");
            }
        }
        finally { _ = closedir(dir); }
    }
    internal StorageEntryIdentity? EntryIdentity(string path, bool directory)
    {
        SafeFileHandle parent; string leaf;
        try { parent = Parent(path, false, out leaf); } catch (FileNotFoundException) { return null; }
        using (parent)
        {
            var fd = openat(checked((int)parent.DangerousGetHandle()), leaf, 0x200000 | NoFollow | CloseExec, 0);
            if (fd < 0) { if (Marshal.GetLastPInvokeError() == 2) return null; throw new WorkerError("unsafe_operator_entry"); }
            using var handle = new SafeFileHandle((IntPtr)fd, true); var stat = new byte[144];
            if (fstat(fd, stat) != 0 || (BitConverter.ToUInt32(stat, 24) & 0xf000) != (directory ? 0x4000u : 0x8000u))
                throw new WorkerError("unsafe_operator_entry");
            ConfirmEntry(parent, leaf, fd);
            return new(BitConverter.ToUInt64(stat, 0), BitConverter.ToUInt64(stat, 8), BitConverter.ToUInt32(stat, 24) & 0xfff,
                BitConverter.ToUInt32(stat, 28), BitConverter.ToUInt32(stat, 32));
        }
    }
    internal StorageEntryIdentity StageDirectory(PrivateDirectory staging, string path)
    {
        using var parent = staging.Parent(path, true, out var leaf);
        if (mkdirat(checked((int)parent.DangerousGetHandle()), leaf, 0x1c0) != 0) throw new WorkerError("publication_directory_conflict");
        var fd = openat(checked((int)parent.DangerousGetHandle()), leaf, DirectoryFlag | NoFollow | CloseExec, 0);
        if (fd < 0) throw new WorkerError("unsafe_storage_parent");
        using var handle = new SafeFileHandle((IntPtr)fd, true); staging.Validate(fd, true);
        AssignCreatedOwner(fd, true); Validate(fd, true); Sync(handle); staging.Sync(parent);
        var stat = new byte[144]; if (fstat(fd, stat) != 0) throw new WorkerError("storage_stat_failed");
        return new(Device, BitConverter.ToUInt64(stat, 8), 0x1c0, uid, gid);
    }
    internal void PublishStagedDirectory(PrivateDirectory staging, string source, string destination, StorageEntryIdentity expected)
    {
        if (staging.Device != Device || staging.EntryIdentity(source, true) != expected) throw new WorkerError("publication_directory_identity_conflict");
        using var old = staging.Parent(source, false, out var oldLeaf); using var target = Parent(destination, false, out var leaf);
        CheckCaseName(target, leaf);
        if (renameat2(checked((int)old.DangerousGetHandle()), oldLeaf, checked((int)target.DangerousGetHandle()), leaf, 1) != 0)
            throw new WorkerError("publication_directory_conflict");
        if (EntryIdentity(destination, true) != expected) throw new WorkerError("publication_directory_identity_conflict");
        staging.Sync(old); Sync(target);
    }
    internal IReadOnlyList<OperatorEntry> OperatorTree(string path, int maxEntries, ulong maxBytes)
    {
        DepotAcquisition.PathName(path);
        SafeFileHandle parent; string leaf;
        try { parent = Parent(path, false, out leaf); } catch (FileNotFoundException) { return []; }
        using (parent)
        {
            var rows = new List<OperatorEntry>();
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            ulong total = 0;
            void Visit(SafeFileHandle owner, string name, string relative, bool rootEntry = false)
            {
                CheckCaseName(owner, name);
                var fd = openat(checked((int)owner.DangerousGetHandle()), name, NoFollow | CloseExec | 0x800, 0);
                if (fd < 0)
                {
                    if (rootEntry && Marshal.GetLastPInvokeError() == 2) return;
                    throw new WorkerError("unsafe_operator_entry");
                }
                using var handle = new SafeFileHandle((IntPtr)fd, true);
                var stat = new byte[144];
                if (fstat(fd, stat) != 0 || BitConverter.ToUInt64(stat, 0) != Device)
                    throw new WorkerError("unsafe_operator_entry");
                var kind = BitConverter.ToUInt32(stat, 24) & 0xf000;
                if (kind is not (0x4000 or 0x8000) || kind == 0x8000 && BitConverter.ToUInt64(stat, 16) != 1)
                    throw new WorkerError("unsafe_operator_entry");
                ConfirmEntry(owner, name, fd);
                if (rows.Count >= maxEntries || !names.Add(relative)) throw new WorkerError("operator_inventory_limit");
                var size = kind == 0x4000 ? 0UL : checked((ulong)BitConverter.ToInt64(stat, 48));
                if (size > maxBytes - total) throw new WorkerError("operator_inventory_limit");
                total += size;
                string? hash = null;
                if (kind == 0x8000)
                {
                    // A duplicate handle keeps the anchored identity alive through hashing.
                    var duplicate = fcntl(fd, 1030, 3);
                    if (duplicate < 0) throw new WorkerError("storage_duplicate_failed");
                    using var stream = new FileStream(new SafeFileHandle((IntPtr)duplicate, true), FileAccess.Read);
                    hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
                    var after = new byte[144];
                    if (fstat(fd, after) != 0 || !stat.AsSpan(0, 72).SequenceEqual(after.AsSpan(0, 72))
                        || !stat.AsSpan(88, 32).SequenceEqual(after.AsSpan(88, 32)))
                        throw new WorkerError("operator_inventory_changed");
                }
                rows.Add(new(relative, kind == 0x4000, hash, size, BitConverter.ToUInt32(stat, 24) & 0xfff,
                    BitConverter.ToUInt32(stat, 28), BitConverter.ToUInt32(stat, 32), Device, BitConverter.ToUInt64(stat, 8)));
                if (kind != 0x4000) return;
                var enumeration = openat(fd, ".", DirectoryFlag | NoFollow | CloseExec, 0);
                if (enumeration < 0) throw new WorkerError("operator_inventory_failed");
                var dir = fdopendir(enumeration);
                if (dir == IntPtr.Zero) { _ = close(enumeration); throw new WorkerError("operator_inventory_failed"); }
                try
                {
                    while (true)
                    {
                        Marshal.WriteInt32(__errno_location(), 0);
                        var entry = readdir(dir);
                        if (entry == IntPtr.Zero)
                        {
                            if (Marshal.GetLastPInvokeError() != 0) throw new WorkerError("operator_inventory_failed");
                            break;
                        }
                        var child = Marshal.PtrToStringUTF8(entry + 19) ?? throw new WorkerError("operator_inventory_failed");
                        if (child is "." or "..") continue;
                        DepotAcquisition.PathName(child);
                        Visit(handle, child, relative + "/" + child);
                    }
                }
                finally { _ = closedir(dir); }
                ConfirmEntry(owner, name, fd);
            }
            Visit(parent, leaf, path, true);
            return rows.OrderBy(r => r.Path, StringComparer.Ordinal).ToArray();
        }
    }
}
