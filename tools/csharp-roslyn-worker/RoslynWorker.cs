using System.Diagnostics;
using System.Text.Json;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.MSBuild;

namespace RoslynWorker;

public static class RoslynWorker
{
    private static readonly HashSet<string> ExcludedDirs = new(StringComparer.Ordinal)
    {
        ".git", "node_modules", "dist", ".lca", "coverage", "build"
    };

    private static readonly HashSet<string> ExcludedSegments = new(StringComparer.Ordinal)
    {
        "bin", "obj"
    };

    private static readonly object MsBuildRegistrationLock = new();
    private static bool _msBuildRegistered;

    public static async Task<WorkerResponse> ExecuteAsync(WorkerRequest request)
    {
        if (request.Version != 1)
        {
            throw new InvalidOperationException($"Unsupported protocol version: {request.Version}.");
        }

        var mode = request.Mode switch
        {
            "find" => SymbolQueryMode.Find,
            "refs" => SymbolQueryMode.Refs,
            _ => throw new InvalidOperationException($"Invalid mode '{request.Mode}'. Expected 'find' or 'refs'.")
        };

        var symbol = request.Symbol?.Trim();
        if (string.IsNullOrEmpty(symbol))
        {
            throw new InvalidOperationException("Symbol text is required.");
        }

        var root = Path.GetFullPath(request.WorkspaceRoot ?? throw new InvalidOperationException("workspaceRoot is required."));
        if (!Directory.Exists(root))
        {
            throw new InvalidOperationException($"Workspace root does not exist: {root}");
        }

        var projects = DiscoverProjects(root);
        if (projects.Count == 0)
        {
            throw new InvalidOperationException($"No .sln or .csproj files found under {root}. C# analysis requires a project file.");
        }

        foreach (var project in projects)
        {
            Restore(project);
        }

        EnsureMsBuildRegistered();

        using var workspace = MSBuildWorkspace.Create();
        foreach (var project in projects)
        {
            if (string.Equals(Path.GetExtension(project), ".sln", StringComparison.OrdinalIgnoreCase))
            {
                await workspace.OpenSolutionAsync(project, cancellationToken: CancellationToken.None);
            }
            else
            {
                await workspace.OpenProjectAsync(project, cancellationToken: CancellationToken.None);
            }
        }

        var solution = workspace.CurrentSolution;
        var results = mode switch
        {
            SymbolQueryMode.Find => await FindDefinitionsAsync(solution, root, symbol),
            _ => await FindReferencesAsync(solution, root, symbol)
        };

        Sort(results);
        return new WorkerResponse(true, results, null);
    }

    public static List<string> DiscoverProjects(string root)
    {
        var slns = new List<string>();
        var csprojs = new List<string>();
        var pending = new Stack<string>();
        pending.Push(root);

        while (pending.Count > 0)
        {
            var dir = pending.Pop();
            string[] subdirs;
            try
            {
                subdirs = Directory.GetDirectories(dir);
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
            {
                continue;
            }

            foreach (var subdir in subdirs)
            {
                if (!ExcludedDirs.Contains(Path.GetFileName(subdir)))
                {
                    pending.Push(subdir);
                }
            }

            try
            {
                slns.AddRange(Directory.GetFiles(dir, "*.sln"));
                csprojs.AddRange(Directory.GetFiles(dir, "*.csproj"));
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
            {
                continue;
            }
        }

        slns.Sort(StringComparer.Ordinal);
        csprojs.Sort(StringComparer.Ordinal);
        return slns.Count > 0 ? slns : csprojs;
    }

    private static async Task<List<SymbolLocationDto>> FindDefinitionsAsync(Solution solution, string root, string symbol)
    {
        var symbols = await SymbolFinder.FindDeclarationsAsync(solution, symbol, ignoreCase: false, CancellationToken.None);
        var output = new List<SymbolLocationDto>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var declaration in symbols)
        {
            foreach (var location in declaration.Locations)
            {
                AddLocation(output, seen, declaration, "definition", "definition", root, symbol, location, "high");
            }
        }

        return output;
    }

    private static async Task<List<SymbolLocationDto>> FindReferencesAsync(Solution solution, string root, string symbol)
    {
        var declarations = await SymbolFinder.FindDeclarationsAsync(solution, symbol, ignoreCase: false, CancellationToken.None);
        var output = new List<SymbolLocationDto>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var declaration in declarations)
        {
            foreach (var location in declaration.Locations)
            {
                AddLocation(output, seen, declaration, "reference", "definition-reference", root, symbol, location, "high");
            }

            var references = await SymbolFinder.FindReferencesAsync(declaration, solution, CancellationToken.None);
            foreach (var referencedSymbol in references)
            {
                foreach (var reference in referencedSymbol.Locations)
                {
                    if (reference.IsImplicit)
                    {
                        continue;
                    }

                    AddLocation(output, seen, declaration, "reference", "reference", root, symbol, reference.Location, "medium");
                    foreach (var additional in reference.AdditionalLocations)
                    {
                        AddLocation(output, seen, declaration, "reference", "reference", root, symbol, additional, "medium");
                    }
                }
            }
        }

        return output;
    }

    private static void AddLocation(
        List<SymbolLocationDto> output,
        HashSet<string> seen,
        ISymbol symbol,
        string kind,
        string role,
        string root,
        string requestedName,
        Location location,
        string confidence)
    {
        var treePath = location.SourceTree?.FilePath;
        if (string.IsNullOrEmpty(treePath))
        {
            return;
        }

        var relativePath = ToRelativePath(root, treePath);
        if (relativePath == null || IsExcluded(relativePath))
        {
            return;
        }

        var key = $"{kind}:{role}:{relativePath}:{location.SourceSpan.Start}";
        if (!seen.Add(key))
        {
            return;
        }

        var position = location.GetLineSpan().StartLinePosition;
        output.Add(new SymbolLocationDto(
            "csharp",
            requestedName,
            kind,
            role,
            relativePath,
            position.Line + 1,
            position.Character + 1,
            confidence,
            "roslyn-compiler-api"));
    }

    internal static string RoleFor(ISymbol symbol) => symbol.Kind switch
    {
        SymbolKind.Namespace => "namespace",
        SymbolKind.NamedType => ((INamedTypeSymbol)symbol).TypeKind switch
        {
            TypeKind.Class => "class",
            TypeKind.Struct => "struct",
            TypeKind.Interface => "interface",
            TypeKind.Enum => "enum",
            TypeKind.Delegate => "delegate",
            TypeKind.Record => "record",
            TypeKind.RecordStruct => "record-struct",
            _ => "type"
        },
        SymbolKind.Method => MethodRole((IMethodSymbol)symbol),
        SymbolKind.Property => "property",
        SymbolKind.Field => "field",
        SymbolKind.Event => "event",
        SymbolKind.Parameter => "parameter",
        SymbolKind.Local => "local",
        SymbolKind.TypeParameter => "type-parameter",
        _ => symbol.Kind.ToString().ToLowerInvariant()
    };

    private static string MethodRole(IMethodSymbol method) => method.MethodKind switch
    {
        MethodKind.Constructor => "constructor",
        MethodKind.StaticConstructor => "static-constructor",
        MethodKind.Destructor => "destructor",
        MethodKind.Operator => "operator",
        MethodKind.Conversion => "conversion-operator",
        MethodKind.LocalFunction => "local-function",
        _ => "method"
    };

    private static void Restore(string target)
    {
        var startInfo = new ProcessStartInfo("dotnet", $"restore \"{target}\"")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };

        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Failed to start dotnet restore.");

        var stderr = process.StandardError.ReadToEnd();
        process.StandardOutput.ReadToEnd();
        process.WaitForExit();

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"dotnet restore failed for {Path.GetFileName(target)}:\n{stderr.Trim()}");
        }
    }

    private static void EnsureMsBuildRegistered()
    {
        if (_msBuildRegistered)
        {
            return;
        }

        lock (MsBuildRegistrationLock)
        {
            if (_msBuildRegistered)
            {
                return;
            }

            if (!MSBuildLocator.IsRegistered)
            {
                MSBuildLocator.RegisterDefaults();
            }

            _msBuildRegistered = true;
        }
    }

    private static string? ToRelativePath(string root, string path)
    {
        var relative = Path.GetRelativePath(root, path);
        if (relative == ".." || relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
        {
            return null;
        }

        return relative.Replace(Path.DirectorySeparatorChar, '/');
    }

    private static bool IsExcluded(string relativePath)
    {
        var segments = relativePath.Split('/');
        if (segments.Length > 0 && ExcludedDirs.Contains(segments[0]))
        {
            return true;
        }

        foreach (var segment in segments)
        {
            if (ExcludedSegments.Contains(segment))
            {
                return true;
            }
        }

        return false;
    }

    private static void Sort(List<SymbolLocationDto> results)
    {
        results.Sort((a, b) =>
        {
            var comparison = string.CompareOrdinal(a.RelativePath, b.RelativePath);
            if (comparison != 0)
            {
                return comparison;
            }

            comparison = a.Line.CompareTo(b.Line);
            if (comparison != 0)
            {
                return comparison;
            }

            comparison = a.Column.CompareTo(b.Column);
            if (comparison != 0)
            {
                return comparison;
            }

            comparison = string.CompareOrdinal(a.Kind, b.Kind);
            if (comparison != 0)
            {
                return comparison;
            }

            return string.CompareOrdinal(a.Role, b.Role);
        });
    }
}
