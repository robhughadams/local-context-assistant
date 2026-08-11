package main

import (
	"path/filepath"
	"testing"

	"golang.org/x/tools/go/packages"
)

func fixtureRoot(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs("../../tests/fixtures/go")
	if err != nil {
		t.Fatalf("resolve fixture root: %v", err)
	}
	return abs
}

func loadFixture(t *testing.T, root string) []*packages.Package {
	t.Helper()
	pkgs, err := loadWorkspacePackages(root)
	if err != nil {
		t.Fatalf("load workspace: %v", err)
	}
	return pkgs
}

func TestFindGreeterIsStructDefinition(t *testing.T) {
	pkgs := loadFixture(t, fixtureRoot(t))
	results := findDefinitions(fixtureRoot(t), "Greeter", pkgs)
	if len(results) != 1 {
		t.Fatalf("expected 1 definition, got %d: %+v", len(results), results)
	}
	loc := results[0]
	if loc.Kind != "definition" || loc.Role != "struct" || loc.Confidence != highConf {
		t.Fatalf("unexpected location: %+v", loc)
	}
	if loc.RelativePath != "greeting/greeting.go" {
		t.Fatalf("unexpected path: %s", loc.RelativePath)
	}
}

func TestFindRoles(t *testing.T) {
	root := fixtureRoot(t)
	pkgs := loadFixture(t, root)
	cases := map[string]string{
		"NewGreeter":  "func",
		"Hello":       "method",
		"DefaultName": "const",
		"Name":        "field",
	}
	for symbol, wantRole := range cases {
		results := findDefinitions(root, symbol, pkgs)
		if len(results) == 0 {
			t.Fatalf("no definitions for %s", symbol)
		}
		for _, loc := range results {
			if loc.Role != wantRole {
				t.Errorf("%s: expected role %s, got %s (%+v)", symbol, wantRole, loc.Role, loc)
			}
		}
	}
}

func TestFindUnknownSymbolReturnsEmpty(t *testing.T) {
	root := fixtureRoot(t)
	pkgs := loadFixture(t, root)
	results := findDefinitions(root, "DoesNotExist", pkgs)
	if len(results) != 0 {
		t.Fatalf("expected no results, got %+v", results)
	}
}

func TestReferencesIncludeDefinitionReferenceAndUsage(t *testing.T) {
	root := fixtureRoot(t)
	pkgs := loadFixture(t, root)
	results := findReferences(root, "NewGreeter", pkgs)
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d: %+v", len(results), results)
	}
	loc := results[0]
	if loc.RelativePath != "cmd/main.go" || loc.Role != "reference" || loc.Kind != "reference" || loc.Confidence != mediumConf {
		t.Fatalf("unexpected usage site: %+v", loc)
	}
	definition := results[1]
	if definition.RelativePath != "greeting/greeting.go" || definition.Role != "definition-reference" || definition.Kind != "definition" || definition.Confidence != highConf {
		t.Fatalf("unexpected definition site: %+v", definition)
	}
}

func TestReferencesCrossPackage(t *testing.T) {
	root := fixtureRoot(t)
	pkgs := loadFixture(t, root)
	results := findReferences(root, "DefaultName", pkgs)
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d: %+v", len(results), results)
	}
	var inMain bool
	for _, loc := range results {
		if loc.RelativePath == "cmd/main.go" {
			inMain = true
		}
	}
	if !inMain {
		t.Fatalf("expected a usage in cmd/main.go: %+v", results)
	}
}

func TestResultsAreDeterministicallySorted(t *testing.T) {
	root := fixtureRoot(t)
	pkgs := loadFixture(t, root)
	first := findReferences(root, "Greeter", pkgs)
	second := findReferences(root, "Greeter", pkgs)
	if len(first) != len(second) {
		t.Fatalf("unstable result sets: %+v vs %+v", first, second)
	}
	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("unstable ordering at %d: %+v vs %+v", i, first[i], second[i])
		}
	}
}
