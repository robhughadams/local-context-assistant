using System.Text.Json.Serialization;

namespace RoslynWorker;

public sealed record WorkerRequest(
    int Version,
    string Mode,
    string Symbol,
    string WorkspaceRoot);

public sealed record SymbolLocationDto(
    string Language,
    string Symbol,
    string Kind,
    string Role,
    string RelativePath,
    int Line,
    int Column,
    string Confidence,
    string Source);

public sealed record WorkerResponse(
    bool Ok,
    IReadOnlyList<SymbolLocationDto>? Results,
    string? Error = null);

public static class JsonOpts
{
    public static readonly JsonSerializerOptions Default = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}
