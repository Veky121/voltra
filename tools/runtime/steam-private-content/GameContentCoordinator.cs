// MIT. Whole-game multi-depot staging and one transactional publication.
using SteamKit2;

namespace Voltra.SteamPrivate;

internal static class GameContentCoordinator
{
    internal static async Task<PrivateReceipt> Run(EntitledPlan plan, ContentSelection selection,
        Func<DepotRequest, IDepotTransport> factory, StagedPublication publication, ulong budget, ulong rollbackReserve,
        PrivateReceipt? previous, CancellationToken cancellation, Action<int>? afterMutation = null, Action<string>? receiptCheckpoint = null)
    {
        if (plan.App != selection.App || plan.Depots.Count is 0 or > 128) throw new WorkerError("invalid_game_plan");
        var transports = new List<(DepotRequest Request, IDepotTransport Transport, IReadOnlyList<DepotManifest.FileData> Files)>();
        Exception? primaryFailure = null;
        try
        {
            var names = new Dictionary<string, (DepotManifest.FileData File, int Owner)>(StringComparer.OrdinalIgnoreCase);
            var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var links = new Dictionary<string, PublicationLink>(StringComparer.OrdinalIgnoreCase);
            ulong total = 0;
            foreach (var request in plan.Depots)
            {
                cancellation.ThrowIfCancellationRequested();
                if (request.Branch != selection.Branch) throw new WorkerError("invalid_game_plan");
                var transport = factory(request);
                transports.Add((request, transport, []));
                await transport.Authorize(request, cancellation);
                var manifest = await transport.Manifest(request, cancellation);
                var files = DepotAcquisition.Preflight(request, manifest, budget);
                if (publication.Mutable is not null)
                {
                    foreach (var entry in manifest.Files!) publication.Mutable.Policy.CheckManifest(entry);
                    publication.Mutable.RegisterManifest(request, manifest.Files!);
                }
                foreach (var directory in manifest.Files!.Where(f => f.Flags.HasFlag(EDepotFileFlag.Directory)))
                {
                    if (directories.TryGetValue(directory.FileName, out var exact) && exact != directory.FileName) throw new WorkerError("cross_depot_directory_conflict");
                    directories.Add(directory.FileName);
                }
                foreach (var entry in manifest.Files!.Where(f => f.Flags.HasFlag(EDepotFileFlag.Symlink)))
                {
                    var link = new PublicationLink(entry.FileName, entry.LinkTarget!, 0x1ff, 0, 0);
                    if (links.TryGetValue(link.Path, out var prior) && prior != link) throw new WorkerError("cross_depot_link_conflict");
                    links[link.Path] = link;
                }
                var owned = new List<DepotManifest.FileData>();
                foreach (var file in files)
                {
                    if (names.TryGetValue(file.FileName, out var collision))
                    {
                        var prior = collision.File;
                        if (prior.FileName != file.FileName || prior.TotalSize != file.TotalSize || !prior.FileHash.AsSpan().SequenceEqual(file.FileHash)
                            || prior.Flags.HasFlag(EDepotFileFlag.Executable) != file.Flags.HasFlag(EDepotFileFlag.Executable))
                            throw new WorkerError("cross_depot_file_conflict");
                        continue; // Identical publisher bytes are staged once.
                    }
                    if (file.TotalSize > budget - total) throw new WorkerError("content_budget_exceeded");
                    total += file.TotalSize;
                    names.Add(file.FileName, (file, transports.Count - 1)); owned.Add(file);
                }
                transports[^1] = (request, transport, owned);
            }
            foreach (var name in names.Keys)
                if (directories.Contains(name) || names.Keys.Any(n => n.StartsWith(name + "/", StringComparison.OrdinalIgnoreCase))
                    || directories.Any(n => n.StartsWith(name + "/", StringComparison.OrdinalIgnoreCase)))
                    throw new WorkerError("cross_depot_file_conflict");
            PublisherLinks.Validate(links.Values.ToArray(), names.Keys, directories, selection.Platform);
            publication.PreflightStorage(names.Values.Select(v => v.File).ToArray(), rollbackReserve);
            var verified = new List<VerifiedFile>();
            foreach (var depot in transports)
                verified.AddRange(await DepotAcquisition.StageFiles(depot.Request, depot.Transport, depot.Files, publication.CreateStage, cancellation));
            publication.StageLinks(links.Values.ToArray());
            // Cache hits and completed staging never replace a current license check.
            foreach (var depot in transports) depot.Transport.ValidateAccess(depot.Request, cancellation);
            return publication.Publish(plan.Depots[0], plan.Build, selection.Platform, selection.Architecture, selection.Language,
                verified, previous, afterMutation, receiptCheckpoint, allDepots: plan.Depots, requestedApp: plan.App, directories: directories.ToArray(), links: links.Values.ToArray());
        }
        catch (WorkerError error) { primaryFailure = error; throw; }
        catch (OperationCanceledException error) { primaryFailure = error; throw; }
        catch (Exception error) { primaryFailure = error; throw new WorkerError("game_content_failed"); }
        finally
        {
            var failed = false;
            foreach (var depot in transports)
                try { await depot.Transport.DisposeAsync(); } catch { failed = true; }
            if (failed && primaryFailure is null) throw new WorkerError("content_teardown_failed");
        }
    }
}
