// MIT. Private local framing, not a Steam authentication command language.
using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

namespace Voltra.SteamPrivate;

internal interface IPrivateMessages
{
    Task SendAsync<T>(T message, CancellationToken cancellation);
    Task<T> ReceiveAsync<T>(CancellationToken cancellation);
}

internal sealed class FdMessages : IPrivateMessages, IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct PollFd { public int Fd; public short Events; public short Revents; }
    [DllImport("libc", SetLastError = true)] private static extern int poll([In, Out] PollFd[] fds, nuint count, int timeout);
    [DllImport("libc", SetLastError = true)] private static extern nint read(int fd, byte[] data, nuint length);
    [DllImport("libc", SetLastError = true)] private static extern nint write(int fd, byte[] data, nuint length);
    [DllImport("libc", SetLastError = true)] private static extern int fcntl(int fd, int command, int argument);
    [DllImport("libc", SetLastError = true)] private static extern int close(int fd);
    private readonly int input;
    private readonly int output;
    private readonly object readLock = new();
    private readonly object writeLock = new();
    private bool disposed;
    internal const int MaximumFrame = 64 * 1024;
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    public FdMessages(int inputFd, int outputFd)
    {
        if (!OperatingSystem.IsLinux() || inputFd < 3 || outputFd < 3) throw new WorkerError("invalid_descriptor");
        input = Duplicate(inputFd);
        try { output = Duplicate(outputFd); } catch { _ = close(input); throw; }
    }

    private static int Duplicate(int fd)
    {
        var result = fcntl(fd, 1030, 3); // F_DUPFD_CLOEXEC
        if (result < 0) throw new WorkerError("invalid_descriptor");
        var flags = fcntl(result, 3, 0); // F_GETFL
        if (flags < 0 || fcntl(result, 4, flags | 2048) < 0) { _ = close(result); throw new WorkerError("invalid_descriptor"); }
        return result;
    }

    private static void Ready(int fd, bool writing, CancellationToken cancellation)
    {
        var descriptors = new[] { new PollFd { Fd = fd, Events = (short)(writing ? 4 : 1) } };
        while (true)
        {
            cancellation.ThrowIfCancellationRequested();
            var result = poll(descriptors, 1, 50);
            if (result < 0 && Marshal.GetLastPInvokeError() == 4) continue;
            if (result < 0 || (descriptors[0].Revents & 32) != 0) throw new WorkerError("protocol_error");
            if (result > 0) return;
        }
    }

    private static byte[] ReadExact(int fd, int length, CancellationToken cancellation)
    {
        var result = new byte[length]; var position = 0;
        while (position < length)
        {
            Ready(fd, false, cancellation); var temporary = new byte[length - position];
            var count = read(fd, temporary, (nuint)temporary.Length);
            if (count < 0 && Marshal.GetLastPInvokeError() is 4 or 11) continue;
            if (count <= 0) throw new WorkerError("protocol_closed");
            Buffer.BlockCopy(temporary, 0, result, position, (int)count); position += (int)count;
            CryptographicOperations.ZeroMemory(temporary);
        }
        return result;
    }

    public Task<T> ReceiveAsync<T>(CancellationToken cancellation) => Task.Run(() =>
    {
        lock (readLock)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            var header = ReadExact(input, 4, cancellation); var length = BinaryPrimitives.ReadUInt32LittleEndian(header);
            if (length == 0 || length > MaximumFrame) throw new WorkerError("invalid_frame");
            var payload = ReadExact(input, (int)length, cancellation);
            try { return JsonSerializer.Deserialize<T>(payload, Json) ?? throw new WorkerError("invalid_frame"); }
            catch (JsonException) { throw new WorkerError("invalid_frame"); }
            finally { CryptographicOperations.ZeroMemory(payload); }
        }
    }, cancellation);

    public Task SendAsync<T>(T message, CancellationToken cancellation) => Task.Run(() =>
    {
        lock (writeLock)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            var payload = JsonSerializer.SerializeToUtf8Bytes(message, Json);
            try
            {
                if (payload.Length == 0 || payload.Length > MaximumFrame) throw new WorkerError("invalid_frame");
                var data = new byte[4 + payload.Length]; BinaryPrimitives.WriteUInt32LittleEndian(data, (uint)payload.Length); payload.CopyTo(data, 4);
                try
                {
                    var position = 0;
                    while (position < data.Length)
                    {
                        Ready(output, true, cancellation); var remaining = data[position..];
                        var count = write(output, remaining, (nuint)remaining.Length);
                        CryptographicOperations.ZeroMemory(remaining);
                        if (count < 0 && Marshal.GetLastPInvokeError() is 4 or 11) continue;
                        if (count <= 0) throw new WorkerError("protocol_closed");
                        position += (int)count;
                    }
                }
                finally { CryptographicOperations.ZeroMemory(data); }
            }
            finally { CryptographicOperations.ZeroMemory(payload); }
        }
    }, cancellation);

    public void Dispose() { if (disposed) return; disposed = true; _ = close(input); _ = close(output); }
}
