// MIT. Lexical merged publisher graph validation. Never follows filesystem links.
namespace Voltra.SteamPrivate;

internal sealed record PublicationLink(string Path, string Target, uint Mode, uint Uid, uint Gid);

internal static class PublisherLinks
{
    internal static string Resolve(string path, string target)
    {
        DepotAcquisition.PathName(path);
        if (string.IsNullOrEmpty(target) || target.StartsWith('/') || target.Contains('\\') || target.Contains(':')
            || target.Any(char.IsControl) || TypedFields.StrictUtf8.GetByteCount(target) > 4096)
            throw new WorkerError("invalid_publisher_link_target");
        var result = path.Split('/').SkipLast(1).ToList();
        foreach (var component in target.Split('/'))
        {
            if (component.Length == 0) throw new WorkerError("invalid_publisher_link_target");
            if (component == ".") continue;
            if (component == "..")
            {
                if (result.Count == 0) throw new WorkerError("publisher_link_escape");
                result.RemoveAt(result.Count - 1);
            }
            else { DepotAcquisition.PathName(component); result.Add(component); }
        }
        if (result.Count == 0) throw new WorkerError("publisher_link_root_target_unsupported");
        return string.Join('/', result);
    }

    internal static void Validate(IReadOnlyList<PublicationLink> links, IEnumerable<string> files, IEnumerable<string> directories, string platform)
    {
        if (links.Count != 0 && platform != "linux") throw new WorkerError("publisher_links_platform_unsupported");
        var all = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var parents = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        void Add(string path)
        {
            DepotAcquisition.PathName(path);
            if (all.TryGetValue(path, out var prior) && prior != path) throw new WorkerError("publisher_link_path_collision");
            all[path] = path;
            var parts = path.Split('/');
            for (var i = 1; i < parts.Length; i++)
            {
                var parent = string.Join('/', parts[..i]);
                if (parents.TryGetValue(parent, out var exact) && exact != parent) throw new WorkerError("publisher_link_path_collision");
                parents[parent] = parent;
            }
        }
        var filePaths = files.ToArray(); var directoryPaths = directories.ToArray();
        foreach (var path in filePaths.Concat(directoryPaths)) Add(path);
        if (filePaths.Intersect(directoryPaths, StringComparer.OrdinalIgnoreCase).Any()) throw new WorkerError("publisher_link_path_collision");
        var mapped = new Dictionary<string, PublicationLink>(StringComparer.OrdinalIgnoreCase);
        foreach (var link in links)
        {
            if (all.ContainsKey(link.Path) || !mapped.TryAdd(link.Path, link)) throw new WorkerError("publisher_link_path_collision");
            Add(link.Path);
        }
        foreach (var link in links)
            if (parents.ContainsKey(link.Path)) throw new WorkerError("publisher_link_parent_unsupported");
        foreach (var file in filePaths)
            if (parents.ContainsKey(file)) throw new WorkerError("publisher_link_path_collision");
        foreach (var link in links)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { link.Path };
            var resolved = Resolve(link.Path, link.Target);
            for (var hops = 0; ; hops++)
            {
                if (hops > 128 || !seen.Add(resolved)) throw new WorkerError("publisher_link_cycle");
                if (mapped.TryGetValue(resolved, out var next)) { resolved = Resolve(next.Path, next.Target); continue; }
                // No path component may pass through another publisher link.
                var components = resolved.Split('/');
                for (var i = 1; i < components.Length; i++)
                    if (mapped.ContainsKey(string.Join('/', components[..i]))) throw new WorkerError("publisher_link_parent_unsupported");
                if (!all.TryGetValue(resolved, out var exact))
                {
                    if (parents.TryGetValue(resolved, out var parent))
                    {
                        if (parent != resolved) throw new WorkerError("publisher_link_target_case_mismatch");
                        break;
                    }
                    throw new WorkerError("publisher_link_unknown_target");
                }
                if (exact != resolved) throw new WorkerError("publisher_link_target_case_mismatch");
                break;
            }
        }
    }
}
