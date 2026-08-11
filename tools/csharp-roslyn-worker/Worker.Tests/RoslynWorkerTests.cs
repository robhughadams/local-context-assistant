using Microsoft.CodeAnalysis;
using Xunit;

namespace RoslynWorker.Tests;

public sealed class TempProject : IDisposable
{
    public string Root { get; }

    private TempProject(string root)
    {
        Root = root;
    }

    public static TempProject Create(Action<string> layout)
    {
        var root = Path.Combine(Path.GetTempPath(), "lca-worker-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var project = new TempProject(root);
        layout(root);
        return project;
    }

    public static string NuGetFreeCsproj(string projectName) =>
        $"""
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <TargetFramework>net10.0</TargetFramework>
            <Nullable>enable</Nullable>
            <ImplicitUsings>enable</ImplicitUsings>
          </PropertyGroup>
        </Project>
        """;

    public void Dispose()
    {
        try
        {
            Directory.Delete(Root, recursive: true);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}

public abstract class WorkerTestBase : IDisposable
{
    protected static async Task<WorkerResponse> RunAsync(string root, string mode, string symbol)
    {
        return await RoslynWorker.ExecuteAsync(new WorkerRequest(1, mode, symbol, root));
    }

    protected static string RelativePathOf(string root, string absolutePath)
    {
        return Path.GetRelativePath(root, absolutePath).Replace(Path.DirectorySeparatorChar, '/');
    }

    public virtual void Dispose()
    {
    }
}

public sealed class DiscoveryTests
{
    [Fact]
    public void DiscoverProjects_FindsSlnOverCsproj()
    {
        using var project = TempProject.Create(root =>
        {
            File.WriteAllText(Path.Combine(root, "App.sln"), "dummy");
            Directory.CreateDirectory(Path.Combine(root, "src"));
            File.WriteAllText(Path.Combine(root, "src", "App.csproj"), "dummy");
            Directory.CreateDirectory(Path.Combine(root, "node_modules", "pkg"));
            File.WriteAllText(Path.Combine(root, "node_modules", "pkg", "Stray.csproj"), "dummy");
        });

        var found = RoslynWorker.DiscoverProjects(project.Root);

        Assert.Single(found);
        Assert.EndsWith("App.sln", found[0]);
    }

    [Fact]
    public void DiscoverProjects_FallsBackToCsproj_WhenNoSln()
    {
        using var project = TempProject.Create(root =>
        {
            Directory.CreateDirectory(Path.Combine(root, "src"));
            File.WriteAllText(Path.Combine(root, "src", "Lib.csproj"), "dummy");
            Directory.CreateDirectory(Path.Combine(root, "dist", "app"));
            File.WriteAllText(Path.Combine(root, "dist", "app", "Generated.csproj"), "dummy");
        });

        var found = RoslynWorker.DiscoverProjects(project.Root);

        var relative = found.Select(f => RelativePathOf(project.Root, f));
        Assert.Equal(new[] { "src/Lib.csproj" }, relative);
    }

    [Fact]
    public void DiscoverProjects_EmptyRoot_ReturnsEmpty()
    {
        using var project = TempProject.Create(_ => { });

        var found = RoslynWorker.DiscoverProjects(project.Root);

        Assert.Empty(found);
    }

    private static string RelativePathOf(string root, string absolutePath)
    {
        return Path.GetRelativePath(root, absolutePath).Replace(Path.DirectorySeparatorChar, '/');
    }
}

public sealed class ProtocolTests
{
    [Fact]
    public async Task Execute_MissingProject_FailsWithActionableError()
    {
        using var project = TempProject.Create(_ => { });

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(1, "find", "Foo", project.Root));

        Assert.False(response.Ok);
        Assert.NotNull(response.Error);
        Assert.Contains("No .sln or .csproj", response.Error);
    }

    [Fact]
    public async Task Execute_InvalidMode_Fails()
    {
        using var project = TempProject.Create(_ => { });

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(1, "grep", "Foo", project.Root));

        Assert.False(response.Ok);
        Assert.Contains("Invalid mode", response.Error);
    }

    [Fact]
    public async Task Execute_EmptySymbol_Fails()
    {
        using var project = TempProject.Create(_ => { });

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(1, "find", "   ", project.Root));

        Assert.False(response.Ok);
        Assert.Contains("Symbol text is required", response.Error);
    }

    [Fact]
    public async Task Execute_MissingWorkspaceRoot_Fails()
    {
        var missing = Path.Combine(Path.GetTempPath(), "lca-worker-tests-missing-" + Guid.NewGuid().ToString("N"));

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(1, "find", "Foo", missing));

        Assert.False(response.Ok);
        Assert.Contains("does not exist", response.Error);
    }

    [Fact]
    public async Task Execute_UnsupportedVersion_Fails()
    {
        using var project = TempProject.Create(_ => { });

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(99, "find", "Foo", project.Root));

        Assert.False(response.Ok);
        Assert.Contains("Unsupported protocol version", response.Error);
    }
}

public sealed class RoleTests
{
    [Fact]
    public void RoleFor_TypesAndMembers_CoversKinds()
    {
        var source = """
            namespace Demo
            {
                public class Bar
                {
                    public Bar() { }
                    ~Bar() { }
                    public void BarMethod() { }
                    public static Bar operator +(Bar a, Bar b) => a;
                    public int Value { get; set; }
                    public int F;
                    public event System.Action? E;
                    public void WithParams(int p) { int local = 1; _ = p; _ = local; }
                    public void Generic<T>() { }
                }
            }
            """;
        var symbols = AllSymbols(source);

        Assert.Equal("class", Role(symbols, "Bar", SymbolKind.NamedType));
        Assert.Equal("constructor", Role(symbols, ".ctor", SymbolKind.Method, m => ((IMethodSymbol)m).MethodKind == MethodKind.Constructor));
        Assert.Equal("destructor", Role(symbols, "Finalize", SymbolKind.Method, m => ((IMethodSymbol)m).MethodKind == MethodKind.Destructor));
        Assert.Equal("method", RoleForSingle(symbols, "BarMethod"));
        Assert.Equal("operator", RoleForSingle(symbols, "op_Addition"));
        Assert.Equal("property", RoleForSingle(symbols, "Value"));
        Assert.Equal("field", RoleForSingle(symbols, "F"));
        Assert.Equal("event", RoleForSingle(symbols, "E"));
        Assert.Equal("parameter", RoleForSingle(symbols, "p"));
        Assert.Equal("local", RoleForSingle(symbols, "local"));
        Assert.Equal("type-parameter", RoleForSingle(symbols, "T"));
    }

    [Fact]
    public void RoleFor_NamedTypes_MapsTypeKind()
    {
        Assert.Equal("struct", Role(AllSymbols("namespace Demo { public struct Foo { } }"), "Foo", SymbolKind.NamedType));
        Assert.Equal("interface", Role(AllSymbols("namespace Demo { public interface Foo { } }"), "Foo", SymbolKind.NamedType));
        Assert.Equal("enum", Role(AllSymbols("namespace Demo { public enum Foo { A } }"), "Foo", SymbolKind.NamedType));
        Assert.Equal("delegate", Role(AllSymbols("namespace Demo { public delegate void Foo(); }"), "Foo", SymbolKind.NamedType));
        Assert.Equal("record", Role(AllSymbols("namespace Demo { public record Foo; }"), "Foo", SymbolKind.NamedType));
        Assert.Equal("namespace", Role(AllSymbols("namespace Demo { public class Bar { } }"), "Demo", SymbolKind.Namespace));
    }

    private static string Role(IReadOnlyList<ISymbol> symbols, string name, SymbolKind kind, Func<ISymbol, bool>? predicate = null)
    {
        ISymbol? match = null;
        foreach (var symbol in symbols)
        {
            if (symbol.Name == name && symbol.Kind == kind && (predicate == null || predicate(symbol)))
            {
                match = symbol;
                break;
            }
        }

        Assert.NotNull(match);
        return RoslynWorker.RoleFor(match!);
    }

    private static string RoleForSingle(IReadOnlyList<ISymbol> symbols, string name)
    {
        ISymbol? match = null;
        foreach (var symbol in symbols)
        {
            if (symbol.Name == name)
            {
                match = symbol;
                break;
            }
        }

        Assert.NotNull(match);
        return RoslynWorker.RoleFor(match!);
    }

    private static IReadOnlyList<ISymbol> AllSymbols(string source)
    {
        var tree = Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree.ParseText(source);
        var compilation = Microsoft.CodeAnalysis.CSharp.CSharpCompilation.Create(
            "role-tests",
            new[] { tree },
            new[] { MetadataReference.CreateFromFile(typeof(object).Assembly.Location) });
        var model = compilation.GetSemanticModel(tree);
        var symbols = new List<ISymbol>();
        foreach (var node in tree.GetRoot().DescendantNodesAndSelf())
        {
            var declared = model.GetDeclaredSymbol(node);
            if (declared != null)
            {
                symbols.Add(declared);
            }
        }

        return symbols;
    }
}

public sealed class IntegrationTests
{
    [Fact]
    public async Task Execute_Find_ReturnsDefinitionsWithHighConfidence()
    {
        using var project = TempProject.Create(root =>
        {
            File.WriteAllText(Path.Combine(root, "Foo.csproj"), TempProject.NuGetFreeCsproj("Foo"));
            File.WriteAllText(Path.Combine(root, "Foo.cs"), "namespace Demo { public class Foo { public void Bar() { } } }");
        });

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(1, "find", "Foo", project.Root));

        Assert.True(response.Ok);
        Assert.NotNull(response.Results);
        var definition = Assert.Single(response.Results);
        Assert.Equal("csharp", definition.Language);
        Assert.Equal("definition", definition.Kind);
        Assert.Equal("class", definition.Role);
        Assert.Equal("high", definition.Confidence);
        Assert.Equal("roslyn-compiler-api", definition.Source);
        Assert.Equal("Foo.cs", definition.RelativePath);
        Assert.Equal(1, definition.Line);
    }

    [Fact]
    public async Task Execute_Find_MissingSymbol_ReturnsEmptyResults()
    {
        using var project = TempProject.Create(root =>
        {
            File.WriteAllText(Path.Combine(root, "Foo.csproj"), TempProject.NuGetFreeCsproj("Foo"));
            File.WriteAllText(Path.Combine(root, "Foo.cs"), "namespace Demo { public class Foo { } }");
        });

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(1, "find", "NoSuchSymbol", project.Root));

        Assert.True(response.Ok);
        Assert.NotNull(response.Results);
        Assert.Empty(response.Results);
    }

    [Fact]
    public async Task Execute_Find_IsCaseSensitive()
    {
        using var project = TempProject.Create(root =>
        {
            File.WriteAllText(Path.Combine(root, "Foo.csproj"), TempProject.NuGetFreeCsproj("Foo"));
            File.WriteAllText(Path.Combine(root, "Foo.cs"), "namespace Demo { public class Foo { } }");
        });

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(1, "find", "foo", project.Root));

        Assert.True(response.Ok);
        Assert.NotNull(response.Results);
        Assert.Empty(response.Results);
    }

    [Fact]
    public async Task Execute_Refs_IncludesDeclarationAndUsage()
    {
        using var project = TempProject.Create(root =>
        {
            File.WriteAllText(Path.Combine(root, "Foo.csproj"), TempProject.NuGetFreeCsproj("Foo"));
            File.WriteAllText(
                Path.Combine(root, "Foo.cs"),
                "namespace Demo\n{\n    public class Foo\n    {\n        public void Bar() { }\n    }\n}\n");
            File.WriteAllText(
                Path.Combine(root, "Program.cs"),
                "namespace Demo\n{\n    public static class Program\n    {\n        public static void Main()\n        {\n            var foo = new Foo();\n            foo.Bar();\n        }\n    }\n}\n");
        });

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(1, "refs", "Bar", project.Root));

        Assert.True(response.Ok);
        Assert.NotNull(response.Results);
        var results = response.Results.ToList();

        var declaration = results.Single(r => r.Confidence == "high");
        Assert.Equal("definition-reference", declaration.Role);
        Assert.Equal("Foo.cs", declaration.RelativePath);
        Assert.Equal(5, declaration.Line);

        var usage = results.Single(r => r.Confidence == "medium");
        Assert.Equal("reference", usage.Role);
        Assert.Equal("Program.cs", usage.RelativePath);
        Assert.Equal(8, usage.Line);
    }

    [Fact]
    public async Task Execute_Find_ResolvesCrossProjectReferences()
    {
        using var project = TempProject.Create(root =>
        {
            Directory.CreateDirectory(Path.Combine(root, "src", "Lib"));
            Directory.CreateDirectory(Path.Combine(root, "src", "App"));
            File.WriteAllText(Path.Combine(root, "src", "Lib", "Lib.csproj"), TempProject.NuGetFreeCsproj("Lib"));
            File.WriteAllText(Path.Combine(root, "src", "App", "App.csproj"), """
                <Project Sdk="Microsoft.NET.Sdk">
                  <PropertyGroup>
                    <TargetFramework>net10.0</TargetFramework>
                    <Nullable>enable</Nullable>
                    <ImplicitUsings>enable</ImplicitUsings>
                  </PropertyGroup>
                  <ItemGroup>
                    <ProjectReference Include="..\Lib\Lib.csproj" />
                  </ItemGroup>
                </Project>
                """);
            File.WriteAllText(Path.Combine(root, "src", "Lib", "Greeter.cs"), "namespace Demo { public class Greeter { public string SayHello(string name) => $\"Hello, {name}!\"; } }");
            File.WriteAllText(Path.Combine(root, "src", "App", "Program.cs"), "namespace Demo { public static class Program { public static void Main() { var g = new Greeter(); _ = g.SayHello(\"world\"); } } }");
        });

        var response = await RoslynWorker.ExecuteAsync(new WorkerRequest(1, "refs", "SayHello", project.Root));

        Assert.True(response.Ok);
        Assert.NotNull(response.Results);
        var results = response.Results.ToList();
        var usage = results.Single(r => r.RelativePath.EndsWith("Program.cs"));
        Assert.Equal("medium", usage.Confidence);
        Assert.Equal("reference", usage.Role);
        Assert.DoesNotContain(results, r => r.RelativePath.Contains("/bin/") || r.RelativePath.Contains("/obj/"));
    }
}