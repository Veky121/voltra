// MIT. Local public-fixture tests only. No SteamClient/network instantiation.
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Channels;
using ProtoBuf;
using SteamKit2.Internal;

namespace Voltra.SteamPrivate;

internal static class SelfTests
{
    private static void Check(bool condition) { if (!condition) throw new InvalidOperationException("fixture assertion"); }
    private static async Task Error(Func<Task> action, string code)
    {
        try { await action(); throw new InvalidOperationException("expected fixed error"); }
        catch (WorkerError error) { Check(error.Code == code); }
    }
    private sealed class Messages : IPrivateMessages
    {
        public readonly Channel<object> Events = Channel.CreateUnbounded<object>();
        public readonly Channel<object> Replies = Channel.CreateUnbounded<object>();
        public Task SendAsync<T>(T value, CancellationToken token) => Events.Writer.WriteAsync(value!, token).AsTask();
        public async Task<T> ReceiveAsync<T>(CancellationToken token) => (T)await Replies.Reader.ReadAsync(token);
    }

    private static Task BetaBytes()
    {
        foreach (var literal in new[] { "+prefix", "-prefix", "  leading trailing  ", "literal \"quote\" \\ tail", "λé_日本語", "e\u0301\u00a0", "tab\tvalue", "\u0001\u000b\u001f\u007f", new string('x', 1024), new string('λ', 512), string.Concat(Enumerable.Repeat("🚀", 256)) })
        {
            var bytes = TypedFields.SerializeBeta(TypedFields.BetaPacket(42, literal, "preview"));
            using var stream = new MemoryStream(bytes); var actual = Serializer.Deserialize<CMsgClientCheckAppBetaPassword>(stream);
            Check(actual.app_id == 42 && actual.betapassword == literal);
            Check(bytes.AsSpan().IndexOf(TypedFields.StrictUtf8.GetBytes(literal)) >= 0);
        }
        foreach (var value in new[] { "bad\r", "bad\n", "bad\0", new string('x', 1025), new string('λ', 513) })
        {
            try { TypedFields.BetaPacket(42, value, "preview"); throw new InvalidOperationException("expected beta rejection"); }
            catch (WorkerError error) { Check(error.Code == "invalid_beta_field"); }
        }
        try { TypedFields.BetaPacket(42, "private", "public"); throw new InvalidOperationException(); } catch (WorkerError) { }
        return Task.CompletedTask;
    }

    private static async Task AuthenticationFields()
    {
        var value = "  +literal \"quotes\" \\ λé\t\u007f  "; var messages = new Messages();
        var authenticator = new FdAuthenticator(messages, TimeSpan.FromSeconds(1), CancellationToken.None, value);
        var request = new PrivateRequest("prepare_only", value, value, value, "preview", value, 42, true);
        Check(!request.ToString().Contains(value) && !new GuardReply("id", "email_code", value, null).ToString().Contains(value));
        var actual = TypedFields.Authentication(request, authenticator);
        Check(actual.Username == value && actual.Password == value && !actual.IsPersistentSession && actual.GuardData is null);
        Check(actual.Authenticator == authenticator && await authenticator.GetEmailCodeAsync("never emitted private address", false) == value);
        Check(!messages.Events.Reader.TryRead(out _));
        await Error(async () => _ = await authenticator.GetEmailCodeAsync("not emitted", false), "challenge_repeated");
    }

    private static async Task GuardState()
    {
        var messages = new Messages(); var auth = new FdAuthenticator(messages, TimeSpan.FromSeconds(1), CancellationToken.None);
        var response = auth.GetDeviceCodeAsync(false); var challenge = (GuardChallenge)await messages.Events.Reader.ReadAsync();
        var literal = "  literal \"guard\" \\ λé  "; await messages.Replies.Writer.WriteAsync(new GuardReply(challenge.ChallengeId, challenge.Kind, literal, null));
        Check(await response == literal);
        await Error(async () => _ = await auth.GetDeviceCodeAsync(false), "challenge_repeated");
        var bad = new FdAuthenticator(new Messages(), TimeSpan.FromSeconds(1), CancellationToken.None);
        await Error(async () => _ = await bad.GetEmailCodeAsync("private", true), "challenge_rejected");
    }

    private static async Task WrongChallenge()
    {
        var messages = new Messages(); var auth = new FdAuthenticator(messages, TimeSpan.FromSeconds(1), CancellationToken.None);
        var task = auth.GetEmailCodeAsync("never emitted", false); _ = await messages.Events.Reader.ReadAsync();
        await messages.Replies.Writer.WriteAsync(new GuardReply("wrong", "device_code", "unchanged", null));
        await Error(async () => _ = await task, "invalid_challenge_reply");
        await Error(async () => _ = await auth.GetDeviceCodeAsync(false), "invalid_challenge_state");
    }

    private static async Task ConfirmAndConcurrency()
    {
        var messages = new Messages(); var auth = new FdAuthenticator(messages, TimeSpan.FromSeconds(1), CancellationToken.None);
        var task = auth.AcceptDeviceConfirmationAsync(); var challenge = (GuardChallenge)await messages.Events.Reader.ReadAsync();
        await Error(async () => _ = await auth.GetDeviceCodeAsync(false), "invalid_challenge_state");
        await messages.Replies.Writer.WriteAsync(new GuardReply(challenge.ChallengeId, challenge.Kind, null, false)); Check(!await task);
    }

    private static async Task CancellationAndTimeout()
    {
        using var cancel = new CancellationTokenSource(); var messages = new Messages();
        var auth = new FdAuthenticator(messages, TimeSpan.FromSeconds(2), cancel.Token);
        var task = auth.GetDeviceCodeAsync(false); _ = await messages.Events.Reader.ReadAsync(); cancel.Cancel();
        await Error(async () => _ = await task, "cancelled");
        var timeout = new FdAuthenticator(new Messages(), TimeSpan.FromMilliseconds(30), CancellationToken.None);
        await Error(async () => _ = await timeout.GetEmailCodeAsync("not emitted", false), "timed_out");
        using var alreadyCancelled = new CancellationTokenSource(); alreadyCancelled.Cancel();
        var supplied = new FdAuthenticator(new Messages(), TimeSpan.FromSeconds(1), alreadyCancelled.Token, "public-guard-fixture");
        try { _ = await supplied.GetDeviceCodeAsync(false); throw new InvalidOperationException(); } catch (OperationCanceledException) { }
    }

    [DllImport("libc", SetLastError = true)] private static extern int pipe([Out] int[] descriptors);
    [DllImport("libc", SetLastError = true)] private static extern int close(int descriptor);
    private static async Task RealPrivateDescriptors()
    {
        var incoming = new int[2]; var outgoing = new int[2]; Check(pipe(incoming) == 0 && pipe(outgoing) == 0);
        try
        {
            using var worker = new FdMessages(incoming[0], outgoing[1]); using var parent = new FdMessages(outgoing[0], incoming[1]);
            var literal = "  +secret \"literal\" \\ λé\t\u007f  ";
            var receive = worker.ReceiveAsync<GuardReply>(CancellationToken.None);
            await parent.SendAsync(new GuardReply("id", "email_code", literal, null), CancellationToken.None);
            Check((await receive).Code == literal);
            using var cancellation = new CancellationTokenSource(30);
            try { _ = await worker.ReceiveAsync<GuardReply>(cancellation.Token); throw new InvalidOperationException(); }
            catch (OperationCanceledException) { }
        }
        finally { foreach (var descriptor in incoming.Concat(outgoing)) _ = close(descriptor); }
    }

    private static Task PublicationBoundary()
    {
        var valid = new ProviderReceipt("steamkit-depot-v1", 42, 1, [new DepotIdentity(43, 1, "preview", "linux")],
            [new VerifiedFile("bin/server", new string('a', 40), new string('b', 64), 1)], true, true, false);
        PublicationPolicy.Validate(valid);
        foreach (var path in new[] { "../outside", "/outside", "C:/outside", "bin\\server", "bin//server" })
        {
            try { PublicationPolicy.Validate(valid with { Files = [valid.Files[0] with { RelativePath = path }] }); throw new InvalidOperationException(); }
            catch (WorkerError error) { Check(error.Code == "invalid_publication_plan"); }
        }
        try { PublicationPolicy.Validate(valid with { Provider = "steamcmd-acf" }); throw new InvalidOperationException(); }
        catch (WorkerError error) { Check(error.Code == "incomplete_provider_receipt"); }
        return Task.CompletedTask;
    }

    public static async Task<int> Run()
    {
        var tests = new (string Name, Func<Task> Body)[] { ("actual_beta_protobuf_bytes", BetaBytes), ("unchanged_auth_details", AuthenticationFields),
            ("typed_guard_state", GuardState), ("wrong_challenge_rejected", WrongChallenge), ("confirmation_concurrency", ConfirmAndConcurrency),
            ("challenge_cancel_timeout", CancellationAndTimeout), ("actual_private_fd_framing", RealPrivateDescriptors), ("distinct_content_receipt", PublicationBoundary),
            ("typed_session_state_machine", SessionTests.Run), ("actual_beta_reply_entitlement", SessionTests.BetaReply),
            ("actual_pics_protobuf_keyvalue", MetadataTests.ActualWire), ("metadata_projection_bounds", MetadataTests.Bounds),
            ("anonymous_metadata_state", MetadataTests.State), ("bounded_session_teardown", MetadataTests.Teardown),
            ("canonical_uint64_json_strings", MetadataAbiTests.Canonical), ("uint64_private_fd_roundtrip", MetadataAbiTests.PrivateFrame),
            ("depot_acquisition_and_corruption", DepotAcquisitionTests.Run),
            ("descriptor_publication_rollback_recovery", StorageTests.Publication), ("descriptor_path_confinement", StorageTests.Confinement),
            ("private_cache_entitlement_scope_quota", StorageTests.Cache), ("atomic_receipt_commit_boundaries", StorageTests.CommitBoundaries),
            ("actual_license_package_shared_dlc_selection", EntitledSelectionTests.Run), ("whole_game_multidepot_transaction", GameContentTests.Run),
            ("neutral_content_operation_receipt_boundary", ContentOperationTests.Run), ("publisher_links_native_transaction", PublisherLinkTests.Run),
            ("operator_metadata_identity_under_lock", PublisherLinkTests.OperatorIdentity), ("actual_sdk_official_cdn_account_policy", OfficialCdnPolicyTests.Run),
            ("receipt_recovery_mechanical_no_private_claim", ReceiptRecoveryTests.MechanicalAndProof),
            ("receipt_recovery_incomplete_bounds_readonly", ReceiptRecoveryTests.IncompleteAndBounded),
            ("receipt_recovery_tamper_protected_paths", ReceiptRecoveryTests.TamperAndProtected),
            ("receipt_recovery_request_lock_boundary", ReceiptRecoveryTests.RequestAndLock),
            ("receipt_recovery_previous_superseded_inventory", ReceiptRecoveryTests.PreviousGeneration),
            ("receipt_readonly_original_deadline", ReceiptRecoveryTests.Deadline),
            ("mutable_v2_actual_coordinator_retention", MutablePublicationTests.Retention),
            ("mutable_v2_policy_partition_attacks", MutablePublicationTests.Attacks),
            ("mutable_v2_actual_transaction_rollback", MutablePublicationTests.Rollback),
            ("mutable_v2_independent_partition_tamper", MutablePublicationTests.PartitionTamper),
            ("mutable_v2_actual_child_crash_recovery", MutablePublicationTests.ProcessCrashes),
            ("mutable_v2_conservative_operator_races", MutablePublicationTests.ConservativeRaces),
            ("mutable_v2_storage_and_private_entry", MutablePublicationTests.StorageAndEntry) };
        foreach (var test in tests)
        {
            try { await test.Body(); }
            catch (Exception error) { Console.WriteLine("FAIL " + test.Name + " " + error.GetType().Name + (error is WorkerError worker ? " " + worker.Code : "")); return 1; }
        }
        Console.WriteLine("PASS " + tests.Length + " offline tests; actual SteamKit fields/protobuf/private FDs; no network/auth/content calls"); return 0;
    }
}
