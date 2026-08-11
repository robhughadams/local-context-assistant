package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestExecuteValidatesProtocolVersion(t *testing.T) {
	response, ok := execute(WorkerRequest{Version: 99, Mode: "find", Symbol: "Greeter", WorkspaceRoot: "x"})
	if ok || response.Ok {
		t.Fatalf("expected failure, got %+v ok=%v", response, ok)
	}
	if !strings.Contains(response.Error, "version") {
		t.Fatalf("unexpected error: %s", response.Error)
	}
}

func TestExecuteValidatesMode(t *testing.T) {
	response, ok := execute(WorkerRequest{Version: 1, Mode: "grep", Symbol: "Greeter", WorkspaceRoot: "x"})
	if ok || !strings.Contains(response.Error, "grep") {
		t.Fatalf("expected invalid-mode failure, got %+v ok=%v", response, ok)
	}
}

func TestExecuteValidatesSymbol(t *testing.T) {
	response, ok := execute(WorkerRequest{Version: 1, Mode: "find", Symbol: "", WorkspaceRoot: "x"})
	if ok || !strings.Contains(response.Error, "Symbol text is required") {
		t.Fatalf("expected symbol-required failure, got %+v ok=%v", response, ok)
	}
}

func TestExecuteMissingModuleReturnsActionableError(t *testing.T) {
	response, ok := execute(WorkerRequest{Version: 1, Mode: "find", Symbol: "Greeter", WorkspaceRoot: "/tmp"})
	if ok || !strings.Contains(response.Error, "main module") {
		t.Fatalf("expected module error, got %+v ok=%v", response, ok)
	}
}

func TestExecuteFindOnFixture(t *testing.T) {
	root, err := filepath.Abs("../../tests/fixtures/go")
	if err != nil {
		t.Fatalf("resolve fixture root: %v", err)
	}
	response, ok := execute(WorkerRequest{Version: 1, Mode: "find", Symbol: "Greeter", WorkspaceRoot: root})
	if !ok || !response.Ok || len(response.Results) != 1 {
		t.Fatalf("expected one definition, got %+v ok=%v", response, ok)
	}
	loc := response.Results[0]
	if loc.Language != langGo || loc.Source != sourceGo || loc.Role != "struct" {
		t.Fatalf("unexpected location: %+v", loc)
	}
}

func TestExecuteRefsOnFixture(t *testing.T) {
	root, err := filepath.Abs("../../tests/fixtures/go")
	if err != nil {
		t.Fatalf("resolve fixture root: %v", err)
	}
	response, ok := execute(WorkerRequest{Version: 1, Mode: "refs", Symbol: "NewGreeter", WorkspaceRoot: root})
	if !ok || !response.Ok || len(response.Results) != 2 {
		t.Fatalf("expected two sites, got %+v ok=%v", response, ok)
	}
}
