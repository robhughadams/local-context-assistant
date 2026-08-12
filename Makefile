.PHONY: install worker

install:
	@node ./scripts/install-harnesses.js

worker:
	@dotnet publish tools/csharp-roslyn-worker/Worker.csproj -c Release -o dist/roslyn
	@if command -v go >/dev/null 2>&1; then echo "building Go worker..."; go build -C tools/go-symbol-worker -o ../../dist/go/go-symbol-worker .; else echo "warning: go not found; skipping Go worker build"; fi
	@if { command -v java >/dev/null 2>&1 || test -x "$$JAVA_HOME/bin/java"; } && command -v gradle >/dev/null 2>&1; then echo "building JVM worker..."; gradle -p tools/jvm-symbol-worker -q --no-daemon shadowJar; mkdir -p dist/jvm; cp tools/jvm-symbol-worker/build/libs/symbol-worker.jar dist/jvm/symbol-worker.jar; else echo "warning: java or gradle not found; skipping JVM worker build"; fi