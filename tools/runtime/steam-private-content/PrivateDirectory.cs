// MIT. Descriptor-relative Linux x64 storage. Unsupported platforms fail closed.
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Voltra.SteamPrivate;

internal sealed partial class PrivateDirectory : IDisposable
{
    private const int DirectoryFlag = 0x10000, NoFollow = 0x20000, CloseExec = 0x80000;
    private const int Create = 0x40, Exclusive = 0x80;
    private readonly SafeFileHandle root;
    private readonly uint uid, gid;
    internal readonly ulong Device;
    internal readonly ulong Inode;
    internal uint OwnerUid => uid;
    internal uint OwnerGid => gid;
    internal bool IsLocked => lockHandle is not null;
    private readonly bool privateModes;
    private SafeFileHandle? lockHandle;
    internal Func<bool>? FailDirectorySync;
    internal Func<ulong>? AvailableBytesOverride;
    internal Func<string, bool>? MutableRoot;
    internal int Descriptor => checked((int)root.DangerousGetHandle());

    [DllImport("libc", SetLastError = true)] private static extern int openat(int fd, string path, int flags, uint mode);
    [DllImport("libc", SetLastError = true)] private static extern int mkdirat(int fd, string path, uint mode);
    [DllImport("libc", SetLastError = true)] private static extern int fstat(int fd, byte[] stat);
    [DllImport("libc", SetLastError = true)] private static extern int fcntl(int fd, int command, int arg);
    [DllImport("libc", SetLastError = true)] private static extern int fsync(int fd);
    [DllImport("libc", SetLastError = true)] private static extern int fchmod(int fd, uint mode);
    [DllImport("libc", SetLastError = true)] private static extern int fchown(int fd, uint uid, uint gid);
    [DllImport("libc", SetLastError = true)] private static extern int fchownat(int fd, string path, uint uid, uint gid, int flags);
    [DllImport("libc", SetLastError = true)] private static extern int fstatvfs(int fd, byte[] statistics);
    [DllImport("libc", SetLastError = true)] private static extern int fstatat(int fd, string path, byte[] stat, int flags);
    [DllImport("libc", SetLastError = true)] private static extern int symlinkat(string target, int fd, string path);
    [DllImport("libc", SetLastError = true)] private static extern nint readlinkat(int fd, string path, byte[] buffer, nuint size);
    [DllImport("libc", SetLastError = true)] private static extern int renameat2(int oldfd, string oldpath, int newfd, string newpath, uint flags);
    [DllImport("libc", SetLastError = true)] private static extern int unlinkat(int fd, string path, int flags);
    [DllImport("libc", SetLastError = true)] private static extern int flock(int fd, int operation);
    [DllImport("libc", SetLastError = true)] private static extern IntPtr fdopendir(int fd);
    [DllImport("libc", SetLastError = true)] private static extern IntPtr readdir(IntPtr directory);
    [DllImport("libc", SetLastError = true)] private static extern int closedir(IntPtr directory);
    [DllImport("libc", SetLastError = true)] private static extern int close(int fd);
    [DllImport("libc")] private static extern IntPtr __errno_location();
    [DllImport("libc")] private static extern uint geteuid();
    [DllImport("libc")] private static extern uint getegid();

    public PrivateDirectory(int inheritedDescriptor, bool privateModes = true)
    {
        if (!OperatingSystem.IsLinux() || RuntimeInformation.ProcessArchitecture != Architecture.X64)
            throw new WorkerError("descriptor_storage_unsupported");
        this.privateModes = privateModes; uid = geteuid(); gid = getegid();
        var fd = fcntl(inheritedDescriptor, 1030, 3); // F_DUPFD_CLOEXEC
        if (fd < 0) throw new WorkerError("invalid_storage_descriptor");
        root = new SafeFileHandle((IntPtr)fd, ownsHandle: true);
        try {
            // Target owner comes only from the admitted root descriptor, never wire input.
            if (!privateModes)
            {
                var rootStat = new byte[144];
                if (fstat(fd, rootStat) != 0) throw new WorkerError("storage_stat_failed");
                uid = BitConverter.ToUInt32(rootStat, 28); gid = BitConverter.ToUInt32(rootStat, 32);
            }
            var stat = Validate(fd, directory: true); Device = BitConverter.ToUInt64(stat, 0); Inode = BitConverter.ToUInt64(stat, 8); }
        catch { root.Dispose(); throw; }
    }

    private byte[] Validate(int fd, bool directory, bool relaxedFileMode = false, (uint Uid, uint Gid)? expectedOwner = null)
    {
        var owner = expectedOwner ?? (uid, gid);
        var stat = new byte[144];
        if (fstat(fd, stat) != 0) throw new WorkerError("storage_stat_failed");
        var mode = BitConverter.ToUInt32(stat, 24);
        if ((mode & 0xf000) != (directory ? 0x4000u : 0x8000u)
            || BitConverter.ToUInt32(stat, 28) != owner.Item1 || BitConverter.ToUInt32(stat, 32) != owner.Item2
            || (mode & 0xe00) != 0 || (mode & 0x12) != 0 || (privateModes && !relaxedFileMode && (mode & 0x3f) != 0)
            || (!directory && BitConverter.ToUInt64(stat, 16) != 1))
            throw new WorkerError("unsafe_storage_entry");
        return stat;
    }

    private SafeFileHandle Parent(string path, bool create, out string leaf)
    {
        DepotAcquisition.PathName(path);
        Validate(Descriptor, true); // The admitted root ownership must remain stable.
        var parts = path.Split('/'); leaf = parts[^1];
        var fd = fcntl(Descriptor, 1030, 3);
        if (fd < 0) throw new WorkerError("storage_open_failed");
        var current = new SafeFileHandle((IntPtr)fd, true);
        try
        {
            var relative = "";
            foreach (var part in parts[..^1])
            {
                relative = relative.Length == 0 ? part : relative + "/" + part;
                if (MutableRoot is not null) CheckCaseName(current, part);
                var created = create && privateModes && mkdirat(checked((int)current.DangerousGetHandle()), part, 0x1c0) == 0;
                var next = openat(checked((int)current.DangerousGetHandle()), part, DirectoryFlag | NoFollow | CloseExec, 0);
                if (next < 0)
                {
                    if (!create && Marshal.GetLastPInvokeError() == 2) throw new FileNotFoundException();
                    throw new WorkerError("unsafe_storage_parent");
                }
                var handle = new SafeFileHandle((IntPtr)next, true);
                try {
                    if (created) AssignCreatedOwner(next, true);
                    if (!privateModes && MutableRoot?.Invoke(relative) == true) ValidateMutableDirectory(next);
                    else Validate(next, directory: true);
                    ConfirmEntry(current, part, next);
                    if (created) Sync(current);
                }
                catch { handle.Dispose(); throw; }
                current.Dispose(); current = handle;
            }
            return current;
        }
        catch { current.Dispose(); throw; }
    }

    public FileStream CreateFile(string path)
    {
        using var parent = Parent(path, true, out var leaf);
        var fd = openat(checked((int)parent.DangerousGetHandle()), leaf, 2 | Create | Exclusive | NoFollow | CloseExec, 0x180);
        if (fd < 0) throw new WorkerError("storage_create_conflict");
        var handle = new SafeFileHandle((IntPtr)fd, true);
        try { AssignCreatedOwner(fd, false); Validate(fd, false); ConfirmEntry(parent, leaf, fd); Sync(parent); return new FileStream(handle, FileAccess.ReadWrite); }
        catch { handle.Dispose(); throw; }
    }

    public FileStream? ReadFile(string path, bool relaxedFileMode = false, (uint Uid, uint Gid)? expectedOwner = null)
    {
        // An alternate owner is only valid for receipt-checked backup files in
        // worker-private storage, never for target admission or cache content.
        if (expectedOwner is not null && (!privateModes || !relaxedFileMode || !path.Contains("/backup/", StringComparison.Ordinal)))
            throw new WorkerError("unsafe_storage_entry");
        SafeFileHandle parent;
        string leaf;
        try { parent = Parent(path, false, out leaf); }
        catch (FileNotFoundException) { return null; }
        using (parent)
        {
            var fd = openat(checked((int)parent.DangerousGetHandle()), leaf, NoFollow | CloseExec | 0x800, 0); // nonblocking special files
            if (fd < 0)
            {
                if (Marshal.GetLastPInvokeError() == 2) return null;
                throw new WorkerError("unsafe_storage_entry");
            }
            var handle = new SafeFileHandle((IntPtr)fd, true);
            try { Validate(fd, false, relaxedFileMode, expectedOwner); ConfirmEntry(parent, leaf, fd); return new FileStream(handle, FileAccess.Read); }
            catch { handle.Dispose(); throw; }
        }
    }

    public void Move(string source, PrivateDirectory destination, string target, Action? afterRenameBeforeSync = null, (uint Uid, uint Gid)? expectedOwner = null)
    {
        if (Device != destination.Device) throw new WorkerError("publication_filesystem_mismatch");
        using var oldParent = Parent(source, false, out var oldLeaf);
        using var newParent = destination.Parent(target, true, out var newLeaf);
        // Hold the exact source inode through ownership assignment and rename.
        var oldFd = checked((int)oldParent.DangerousGetHandle());
        var sourceFd = openat(oldFd, oldLeaf, 0x200000 | NoFollow | CloseExec, 0); // O_PATH, no link traversal
        if (sourceFd < 0) throw new WorkerError("unsafe_storage_entry");
        using var sourceHandle = new SafeFileHandle((IntPtr)sourceFd, true);
        var stat = new byte[144];
        if (fstat(sourceFd, stat) != 0) throw new WorkerError("storage_stat_failed");
        var sourceOwner = expectedOwner ?? (uid, gid);
        var kind = BitConverter.ToUInt32(stat, 24) & 0xf000;
        if (kind is not (0x8000 or 0xa000) || BitConverter.ToUInt64(stat, 16) != 1
            || BitConverter.ToUInt32(stat, 28) != sourceOwner.Item1 || BitConverter.ToUInt32(stat, 32) != sourceOwner.Item2)
            throw new WorkerError("unsafe_storage_entry");
        ConfirmEntry(oldParent, oldLeaf, sourceFd);
        if (!destination.privateModes && sourceOwner != (destination.uid, destination.gid))
        {
            // Only validated publication files/links reach this move. Backups keep
            // their original owner; Work and Cache directories stay worker-private.
            if (fchownat(sourceFd, "", destination.uid, destination.gid, 0x1000 | 0x100) != 0)
                throw new WorkerError("publication_owner_failed");
            var after = new byte[144];
            if (fstat(sourceFd, after) != 0 || BitConverter.ToUInt32(after, 28) != destination.uid
                || BitConverter.ToUInt32(after, 32) != destination.gid
                || BitConverter.ToUInt32(after, 24) != BitConverter.ToUInt32(stat, 24))
                throw new WorkerError("publication_owner_failed");
        }
        ConfirmEntry(oldParent, oldLeaf, sourceFd);
        // No clobber, including a symlink or a file created after preflight.
        if (renameat2(checked((int)oldParent.DangerousGetHandle()), oldLeaf,
            checked((int)newParent.DangerousGetHandle()), newLeaf, 1) != 0)
            throw new WorkerError("publication_rename_conflict");
        ConfirmEntry(newParent, newLeaf, sourceFd);
        afterRenameBeforeSync?.Invoke();
        Sync(oldParent); destination.Sync(newParent);
    }

    public void Delete(string path)
    {
        using var parent = Parent(path, false, out var leaf);
        if (unlinkat(checked((int)parent.DangerousGetHandle()), leaf, 0) != 0) throw new WorkerError("storage_remove_failed");
        Sync(parent);
    }

    internal bool DirectoryExists(string path)
    {
        SafeFileHandle parent; string leaf;
        try { parent = Parent(path, false, out leaf); } catch (FileNotFoundException) { return false; }
        using (parent)
        {
            var fd = openat(checked((int)parent.DangerousGetHandle()), leaf, DirectoryFlag | NoFollow | CloseExec, 0);
            if (fd < 0) { if (Marshal.GetLastPInvokeError() == 2) return false; throw new WorkerError("unsafe_storage_parent"); }
            using var handle = new SafeFileHandle((IntPtr)fd, true);
            if (!privateModes && MutableRoot?.Invoke(path) == true) ValidateMutableDirectory(fd); else Validate(fd, true);
            ConfirmEntry(parent, leaf, fd); return true;
        }
    }

    internal (uint Mode, uint Uid, uint Gid) DirectoryIdentity(string path)
    {
        using var parent = Parent(path, false, out var leaf);
        var fd = openat(checked((int)parent.DangerousGetHandle()), leaf, DirectoryFlag | NoFollow | CloseExec, 0);
        if (fd < 0) throw new WorkerError("unsafe_storage_parent");
        using var handle = new SafeFileHandle((IntPtr)fd, true);
        var stat = !privateModes && MutableRoot?.Invoke(path) == true ? ValidateMutableDirectory(fd) : Validate(fd, true);
        ConfirmEntry(parent, leaf, fd);
        return (BitConverter.ToUInt32(stat, 24) & 0xfff, BitConverter.ToUInt32(stat, 28), BitConverter.ToUInt32(stat, 32));
    }

    internal void CreateDirectory(string path, PrivateDirectory? staging = null, string? stagingPath = null)
    {
        using var parent = Parent(path, false, out var leaf);
        if (!privateModes)
        {
            // mkdir+chown in the target has an unrecoverable crash window. Make
            // the complete owned directory inode in worker-private storage first.
            if (staging is null || !staging.privateModes || stagingPath is null || staging.Device != Device)
                throw new WorkerError("publication_directory_staging_required");
            using var sourceParent = staging.Parent(stagingPath, false, out var sourceLeaf);
            var sourceParentFd = checked((int)sourceParent.DangerousGetHandle());
            if (mkdirat(sourceParentFd, sourceLeaf, 0x1c0) != 0) throw new WorkerError("publication_directory_conflict");
            var stagedFd = openat(sourceParentFd, sourceLeaf, DirectoryFlag | NoFollow | CloseExec, 0);
            if (stagedFd < 0) throw new WorkerError("unsafe_storage_parent");
            using var stagedHandle = new SafeFileHandle((IntPtr)stagedFd, true);
            staging.Validate(stagedFd, true);
            ConfirmEntry(sourceParent, sourceLeaf, stagedFd);
            AssignCreatedOwner(stagedFd, true); Validate(stagedFd, true); Sync(stagedHandle);
            ConfirmEntry(sourceParent, sourceLeaf, stagedFd);
            if (renameat2(sourceParentFd, sourceLeaf, checked((int)parent.DangerousGetHandle()), leaf, 1) != 0)
                throw new WorkerError("publication_directory_conflict");
            ConfirmEntry(parent, leaf, stagedFd);
            staging.Sync(sourceParent); Sync(parent);
            return;
        }
        if (mkdirat(checked((int)parent.DangerousGetHandle()), leaf, 0x1c0) != 0) throw new WorkerError("publication_directory_conflict");
        var fd = openat(checked((int)parent.DangerousGetHandle()), leaf, DirectoryFlag | NoFollow | CloseExec, 0);
        if (fd < 0) throw new WorkerError("unsafe_storage_parent");
        using var handle = new SafeFileHandle((IntPtr)fd, true);
        AssignCreatedOwner(fd, true); Validate(fd, true); ConfirmEntry(parent, leaf, fd); Sync(handle);
        Sync(parent);
    }

    internal void DeleteEmptyDirectory(string path)
    {
        if (!DirectoryExists(path)) return;
        using var parent = Parent(path, false, out var leaf);
        if (unlinkat(checked((int)parent.DangerousGetHandle()), leaf, 0x200) != 0) throw new WorkerError("publication_directory_not_empty");
        Sync(parent);
    }

    internal PublicationLink? ReadLink(string path, (uint Uid, uint Gid)? expectedOwner = null)
    {
        if (expectedOwner is not null && (!privateModes || !path.Contains("/backup-links/", StringComparison.Ordinal)))
            throw new WorkerError("unsafe_publisher_link_entry");
        SafeFileHandle parent; string leaf;
        try { parent = Parent(path, false, out leaf); } catch (FileNotFoundException) { return null; }
        using (parent)
        {
            var fd = checked((int)parent.DangerousGetHandle());
            var stat = new byte[144];
            if (fstatat(fd, leaf, stat, 0x100) != 0)
            { if (Marshal.GetLastPInvokeError() == 2) return null; throw new WorkerError("unsafe_storage_entry"); }
            var mode = BitConverter.ToUInt32(stat, 24);
            var owner = expectedOwner ?? (uid, gid);
            if ((mode & 0xf000) != 0xa000 || BitConverter.ToUInt32(stat, 28) != owner.Item1 || BitConverter.ToUInt32(stat, 32) != owner.Item2
                || BitConverter.ToUInt64(stat, 16) != 1) throw new WorkerError("unsafe_publisher_link_entry");
            var bytes = new byte[4097];
            var count = readlinkat(fd, leaf, bytes, (nuint)bytes.Length);
            if (count < 1 || count > 4096) throw new WorkerError("invalid_publisher_link_target");
            string value;
            try { value = TypedFields.StrictUtf8.GetString(bytes, 0, (int)count); }
            catch { throw new WorkerError("invalid_publisher_link_target"); }
            var after = new byte[144];
            if (fstatat(fd, leaf, after, 0x100) != 0 || !stat.AsSpan(0, 40).SequenceEqual(after.AsSpan(0, 40)))
                throw new WorkerError("storage_identity_changed");
            return new(path, value, mode & 0xfff, owner.Item1, owner.Item2);
        }
    }

    internal void CreateLink(string path, string linkTarget)
    {
        // Validation is lexical and graph-based before this method; this native
        // operation only creates the link, and never opens its target.
        PublisherLinks.Resolve(path, linkTarget);
        using var parent = Parent(path, true, out var leaf);
        if (symlinkat(linkTarget, checked((int)parent.DangerousGetHandle()), leaf) != 0) throw new WorkerError("publisher_link_create_conflict");
        Sync(parent);
    }

    public static void SetMode(FileStream file, uint mode)
    {
        if (mode is not (0x180 or 0x1c0 or 0x1a4 or 0x1ed)) throw new WorkerError("invalid_publication_mode");
        if (fchmod(checked((int)file.SafeFileHandle.DangerousGetHandle()), mode) != 0) throw new WorkerError("storage_mode_failed");
        file.Flush(true);
    }

    internal static (ulong Bytes, uint Mode, uint Uid, uint Gid) Identity(FileStream file)
    {
        var stat = new byte[144];
        if (fstat(checked((int)file.SafeFileHandle.DangerousGetHandle()), stat) != 0) throw new WorkerError("storage_stat_failed");
        return (checked((ulong)BitConverter.ToInt64(stat, 48)), BitConverter.ToUInt32(stat, 24) & 0xfff,
            BitConverter.ToUInt32(stat, 28), BitConverter.ToUInt32(stat, 32));
    }

    internal ulong AvailableBytes()
    {
        if (AvailableBytesOverride is not null) return AvailableBytesOverride();
        var stat = new byte[112];
        if (fstatvfs(Descriptor, stat) != 0) throw new WorkerError("storage_space_check_failed");
        try { return checked(BitConverter.ToUInt64(stat, 8) * BitConverter.ToUInt64(stat, 32)); }
        catch (OverflowException) { throw new WorkerError("storage_space_check_failed"); }
    }

    internal void LockExclusive()
    {
        if (lockHandle is not null) throw new WorkerError("storage_busy");
        var fd = openat(Descriptor, ".", DirectoryFlag | NoFollow | CloseExec, 0);
        if (fd < 0) throw new WorkerError("storage_lock_failed");
        var handle = new SafeFileHandle((IntPtr)fd, true);
        if (flock(fd, 2 | 4) != 0) { handle.Dispose(); throw new WorkerError("storage_busy"); }
        lockHandle = handle;
    }
    internal void Unlock()
    {
        if (lockHandle is null) throw new WorkerError("storage_lock_missing");
        lockHandle.Dispose(); lockHandle = null; // Closing the independent description releases flock.
    }

    internal ulong StorageBytes()
    {
        var entries = 0;
        ulong Walk(int parent)
        {
            // Open a new file description so directory enumeration has an
            // independent offset from the inherited descriptor.
            var fd = openat(parent, ".", DirectoryFlag | NoFollow | CloseExec, 0);
            if (fd < 0) throw new WorkerError("cache_inventory_failed");
            var dir = fdopendir(fd);
            if (dir == IntPtr.Zero) { _ = close(fd); throw new WorkerError("cache_inventory_failed"); }
            ulong bytes = 4096;
            try
            {
                while (true)
                {
                    Marshal.WriteInt32(__errno_location(), 0);
                    var entry = readdir(dir);
                    if (entry == IntPtr.Zero)
                    {
                        if (Marshal.GetLastPInvokeError() != 0) throw new WorkerError("cache_inventory_failed");
                        break;
                    }
                    var name = Marshal.PtrToStringUTF8(entry + 19) ?? throw new WorkerError("cache_inventory_failed");
                    if (name is "." or "..") continue;
                    if (++entries > 1000000) throw new WorkerError("cache_inventory_limit");
                    DepotAcquisition.PathName(name);
                    var child = openat(parent, name, NoFollow | CloseExec | 0x800, 0);
                    if (child < 0) throw new WorkerError("unsafe_storage_entry");
                    using var handle = new SafeFileHandle((IntPtr)child, true);
                    var stat = new byte[144];
                    if (fstat(child, stat) != 0) throw new WorkerError("cache_inventory_failed");
                    var directory = (BitConverter.ToUInt32(stat, 24) & 0xf000) == 0x4000;
                    Validate(child, directory);
                    bytes = checked(bytes + (directory ? Walk(child) : checked((ulong)BitConverter.ToInt64(stat, 48) + 4096)));
                }
                return bytes;
            }
            finally { _ = closedir(dir); }
        }
        return Walk(Descriptor);
    }

    internal void ConfirmDurable(string path)
    {
        using var file = ReadFile(path) ?? throw new WorkerError("storage_file_missing");
        Sync(file.SafeFileHandle);
        using var parent = Parent(path, false, out _);
        Sync(parent);
    }

    private void AssignCreatedOwner(int fd, bool directory)
    {
        Validate(fd, directory, expectedOwner: (geteuid(), getegid()));
        if ((uid != geteuid() || gid != getegid()) && fchown(fd, uid, gid) != 0)
            throw new WorkerError("publication_owner_failed");
    }

    private static void ConfirmEntry(SafeFileHandle parent, string leaf, int fd)
    {
        var opened = new byte[144]; var named = new byte[144];
        if (fstat(fd, opened) != 0 || fstatat(checked((int)parent.DangerousGetHandle()), leaf, named, 0x100) != 0
            || BitConverter.ToUInt64(opened, 0) != BitConverter.ToUInt64(named, 0)
            || BitConverter.ToUInt64(opened, 8) != BitConverter.ToUInt64(named, 8))
            throw new WorkerError("storage_identity_changed");
    }

    private void Sync(SafeFileHandle handle)
    {
        if (FailDirectorySync?.Invoke() == true || fsync(checked((int)handle.DangerousGetHandle())) != 0) throw new WorkerError("storage_sync_failed");
    }
    public void Dispose() { lockHandle?.Dispose(); lockHandle = null; root.Dispose(); }
}
