using System.Text.Json;
using RoslynWorker;
using Worker = RoslynWorker.RoslynWorker;

var input = Console.In.ReadToEnd();
WorkerResponse response;

try
{
    var request = JsonSerializer.Deserialize<WorkerRequest>(input, JsonOpts.Default)
        ?? throw new InvalidOperationException("Request payload is empty or malformed.");
    response = await Worker.ExecuteAsync(request);
}
catch (Exception ex)
{
    response = new WorkerResponse(false, null, ex.Message);
}

Console.Out.WriteLine(JsonSerializer.Serialize(response, JsonOpts.Default));
return response.Ok ? 0 : 1;