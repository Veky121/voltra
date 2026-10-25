// MIT. Implements SteamKit's actual typed challenge interface without Console.
using System.Security.Cryptography;
using SteamKit2.Authentication;

namespace Voltra.SteamPrivate;

internal sealed record GuardChallenge(string Type, string ChallengeId, string Kind);
internal sealed record GuardReply(string ChallengeId, string Kind, string? Code, bool? Accepted)
{
    public override string ToString() => "GuardReply [private]";
}

internal sealed class FdAuthenticator(IPrivateMessages messages, TimeSpan timeout,
    CancellationToken cancellation, string? initialGuard = null) : IAuthenticator
{
    private readonly HashSet<string> usedKinds = [];
    private string? guard = initialGuard;
    private int active;
    private bool failed;

    public Task<string> GetDeviceCodeAsync(bool previousCodeWasIncorrect) => Code("device_code", previousCodeWasIncorrect);
    public Task<string> GetEmailCodeAsync(string email, bool previousCodeWasIncorrect) => Code("email_code", previousCodeWasIncorrect);
    public async Task<bool> AcceptDeviceConfirmationAsync() => (await Challenge("device_confirmation", false)).Accepted
        ?? throw new WorkerError("invalid_challenge_reply");

    private async Task<string> Code(string kind, bool previousIncorrect)
    {
        cancellation.ThrowIfCancellationRequested();
        if (timeout <= TimeSpan.Zero || timeout > TimeSpan.FromMinutes(5)) throw new WorkerError("invalid_deadline");
        if (previousIncorrect) { failed = true; throw new WorkerError("challenge_rejected"); }
        if (guard is not null)
        {
            if (failed || active != 0 || usedKinds.Count != 0) throw new WorkerError("invalid_challenge_state");
            var result = guard; guard = null; usedKinds.Add(kind); return result;
        }
        return (await Challenge(kind, false)).Code ?? throw new WorkerError("invalid_challenge_reply");
    }

    private async Task<GuardReply> Challenge(string kind, bool previousIncorrect)
    {
        if (timeout <= TimeSpan.Zero || timeout > TimeSpan.FromMinutes(5)) throw new WorkerError("invalid_deadline");
        if (failed || previousIncorrect || Interlocked.CompareExchange(ref active, 1, 0) != 0)
            throw new WorkerError("invalid_challenge_state");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation); deadline.CancelAfter(timeout);
        try
        {
            if (!usedKinds.Add(kind)) throw new WorkerError("challenge_repeated");
            var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            await messages.SendAsync(new GuardChallenge("guard_required", id, kind), deadline.Token);
            var reply = await messages.ReceiveAsync<GuardReply>(deadline.Token);
            if (reply.ChallengeId != id || reply.Kind != kind || kind == "device_confirmation" && (reply.Accepted is null || reply.Code is not null)
                || kind != "device_confirmation" && (reply.Code is null || reply.Accepted is not null))
                throw new WorkerError("invalid_challenge_reply");
            return reply;
        }
        catch (OperationCanceledException) { failed = true; throw new WorkerError(cancellation.IsCancellationRequested ? "cancelled" : "timed_out"); }
        catch { failed = true; throw; }
        finally { Interlocked.Exchange(ref active, 0); }
    }
}
