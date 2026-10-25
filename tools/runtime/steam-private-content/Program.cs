// MIT. Standalone opt-in transport; no production caller is enabled.
using System.Runtime.InteropServices;

namespace Voltra.SteamPrivate;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        SteamKit2.DebugLog.Enabled = false;
        if (args.SequenceEqual(new[] { "--self-test" })) return await SelfTests.Run();
        // Offline fixture proof only; never a private-FD mode or production policy.
        if (args.Length == 3 && args[0] == "--self-test-mutable-crash") return await MutablePublicationTests.CrashChild(args[1], args[2]);
        // Public synthetic regression only; never consumes a request/credential
        // and never creates a SteamClient or invokes any network operation.
        if (args.Length == 2 && args[0] == "--self-test-metadata-fd" && int.TryParse(args[1], out var fixtureFd) && fixtureFd >= 3)
        {
            using var fixture = new FdMessages(fixtureFd, fixtureFd);
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await fixture.SendAsync(new { Type = "terminal", Status = "metadata", Metadata = MetadataAbiTests.Fixture() }, deadline.Token);
            return 0;
        }
        // No credential, URL, account or publisher option can be a CLI operand.
        if (args.Length != 6 || args[0] != "--request-fd" || args[2] != "--event-fd" || args[4] != "--reply-fd"
            || !int.TryParse(args[1], out var request) || !int.TryParse(args[3], out var events)
            || !int.TryParse(args[5], out var replies) || new[] { request, events, replies }.Distinct().Count() != 3)
            return 2;
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var term = OperatingSystem.IsLinux() ? PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => { context.Cancel = true; cancellation.Cancel(); }) : null;
        FdMessages? requests = null;
        try
        {
            requests = new FdMessages(request, events);
            using var challenges = new FdMessages(replies, events);
            var input = await requests.ReceiveAsync<PrivateRequest>(cancellation.Token);
            if (input.Operation == "recover_private_receipt_mutable_v1")
            {
                cancellation.CancelAfter(ContentOperation.ReceiptDeadline(input, [request, events, replies]));
                var recovered = ContentOperation.RecoverMutableReceipt(input, [request, events, replies]);
                await requests.SendAsync(new { Type = "terminal", Status = recovered.RolledBack ? "publication_rolled_back" : "receipt_recovered",
                    Receipt = recovered.Receipt, NativeAcceptanceVerified = false }, cancellation.Token);
                return 0;
            }
            if (input.Operation is "validate_private_receipt" or "recover_private_receipt" or "validate_private_receipt_mutable_v1" or "recover_private_receipt_mutable_v1")
            {
                cancellation.CancelAfter(ContentOperation.ReceiptDeadline(input, [request, events, replies]));
                var validating = input.Operation.StartsWith("validate_private_receipt", StringComparison.Ordinal);
                var validated = validating
                    ? ContentOperation.ValidateReceipt(input, [request, events, replies])
                    : ContentOperation.RecoverReceipt(input, [request, events, replies]);
                await requests.SendAsync(new { Type = "terminal", Status = validating ? "receipt_validated" : "receipt_recovered",
                    Receipt = validated, NativeAcceptanceVerified = false }, cancellation.Token);
                return 0;
            }
            if (input.Operation is "private_content" or "private_content_mutable_v1")
            {
                ContentOperation.Validate(input, [request, events, replies]);
                cancellation.CancelAfter(TimeSpan.FromSeconds(input.Content!.DeadlineSeconds));
                var contentGuard = new FdAuthenticator(challenges, TimeSpan.FromSeconds(20), cancellation.Token, input.Guard);
                var receipt = await ContentOperation.Run(input, contentGuard, [request, events, replies], () => new SteamKitSession(), cancellation.Token);
                await requests.SendAsync(new { Type = "terminal", Status = "publication_committed", Receipt = receipt, NativeAcceptanceVerified = false }, cancellation.Token);
                return 0;
            }
            if (input.Operation == "anonymous_metadata")
            {
                var metadata = await MetadataOperation.Run(input, () => new SteamKitSession(), cancellation.Token);
                await requests.SendAsync(new { Type = "terminal", Status = "metadata", Metadata = metadata }, cancellation.Token);
                return 0;
            }
            var guard = new FdAuthenticator(challenges, TimeSpan.FromSeconds(20), cancellation.Token, input.Guard);
            _ = TypedFields.Authentication(input, guard);
            _ = TypedFields.BetaPacket(input.AppId, input.BetaPassword, input.Branch);
            if (input.Operation == "authenticate_beta")
            {
                await SessionOperation.Run(input, guard, () => new SteamKitSession(), cancellation.Token);
                await requests.SendAsync(new { Type = "terminal", Status = "session_completed" }, cancellation.Token);
            }
            else await requests.SendAsync(new { Type = "terminal", Status = "provider_not_enabled" }, cancellation.Token);
            return 0;
        }
        catch (WorkerError error) { await Failure(requests, error.Code); return 3; }
        catch (OperationCanceledException) { await Failure(requests, "cancelled"); return 4; }
        catch { await Failure(requests, "provider_error"); return 5; }
        finally { requests?.Dispose(); }
        // stdout/stderr and publisher exception text are never emitted here.
    }

    private static async Task Failure(FdMessages? messages, string code)
    {
        if (messages is null) return;
        using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(250));
        try { await messages.SendAsync(new { Type = "terminal", Status = "error", Code = code }, timeout.Token); }
        catch { /* Closed private channel: fixed process status only, no output. */ }
    }
}
