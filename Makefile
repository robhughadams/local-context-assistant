.PHONY: install worker

install:
	@node ./scripts/install-harnesses.js

worker:
	@dotnet publish tools/csharp-roslyn-worker/Worker.csproj -c Release -o dist/roslyn