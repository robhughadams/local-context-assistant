package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

func main() {
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		writeResponse(errorResponse(fmt.Sprintf("failed to read request: %v", err)))
		os.Exit(1)
	}

	var request WorkerRequest
	if err := json.Unmarshal(input, &request); err != nil {
		writeResponse(errorResponse(fmt.Sprintf("request payload is empty or malformed: %v", err)))
		os.Exit(1)
	}

	response, status := execute(request)
	writeResponse(response)
	if !status {
		os.Exit(1)
	}
}

func execute(request WorkerRequest) (WorkerResponse, bool) {
	if request.Version != protocolVersion {
		return errorResponse(fmt.Sprintf("Unsupported protocol version %d. Expected %d.", request.Version, protocolVersion)), false
	}
	if request.Mode != "find" && request.Mode != "refs" {
		return errorResponse(fmt.Sprintf("Invalid mode '%s'. Expected 'find' or 'refs'.", request.Mode)), false
	}
	if request.Symbol == "" {
		return errorResponse("Symbol text is required."), false
	}
	pkgs, err := loadWorkspacePackages(request.WorkspaceRoot)
	if err != nil {
		return errorResponse(err.Error()), false
	}
	if request.Mode == "find" {
		return WorkerResponse{Ok: true, Results: findDefinitions(request.WorkspaceRoot, request.Symbol, pkgs)}, true
	}
	return WorkerResponse{Ok: true, Results: findReferences(request.WorkspaceRoot, request.Symbol, pkgs)}, true
}

func writeResponse(response WorkerResponse) {
	encoded, err := json.Marshal(response)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to encode response: %v\n", err)
		return
	}
	os.Stdout.Write(append(encoded, '\n'))
}
