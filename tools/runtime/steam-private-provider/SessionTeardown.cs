// MIT. Own-session teardown deadline; parent must hard-kill after failure.
namespace Voltra.SteamPrivate;

internal static class SessionTeardown
{
    public static async Task Run(Func<Task> disconnect, Task pump, CancellationTokenSource lifetime, TimeSpan deadline)
    {
        if (deadline <= TimeSpan.Zero || deadline > TimeSpan.FromSeconds(2)) throw new WorkerError("invalid_deadline");
        lifetime.Cancel();
        try { await Task.WhenAll(Task.Run(disconnect), pump).WaitAsync(deadline); }
        catch (TimeoutException) { throw new WorkerError("session_teardown_timeout"); }
        catch { throw new WorkerError("session_teardown_failed"); }
    }
}
