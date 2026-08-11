package main

import (
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

const (
	sourceGo   = "go-type-checker"
	langGo     = "go"
	highConf   = "high"
	mediumConf = "medium"
)

var excludedDirSegments = map[string]bool{
	".git": true, "node_modules": true, "dist": true, ".lca": true,
	"coverage": true, "build": true, "bin": true, "obj": true,
}

func loadWorkspacePackages(workspaceRoot string) ([]*packages.Package, error) {
	cfg := &packages.Config{
		Mode: packages.LoadAllSyntax,
		Dir:  workspaceRoot,
	}
	pkgs, err := packages.Load(cfg, "./...")
	if err != nil {
		return nil, err
	}
	var usable []*packages.Package
	for _, pkg := range pkgs {
		for _, pkgErr := range pkg.Errors {
			if pkgErr.Kind == packages.ListError {
				return nil, fmt.Errorf("go list failed: %s", pkgErr.Msg)
			}
		}
		if pkg.ForTest != "" {
			continue
		}
		usable = append(usable, pkg)
	}
	if len(usable) == 0 {
		return nil, fmt.Errorf("no Go packages found under %s; is this a Go module (go.mod present)?", workspaceRoot)
	}
	return usable, nil
}

func findDefinitions(workspaceRoot string, symbolName string, pkgs []*packages.Package) []SymbolLocation {
	output := make([]SymbolLocation, 0)
	for _, pkg := range pkgs {
		for _, file := range pkg.Syntax {
			ast.Inspect(file, func(n ast.Node) bool {
				ident, ok := n.(*ast.Ident)
				if !ok {
					return true
				}
				obj, defined := pkg.TypesInfo.Defs[ident]
				if !defined || obj == nil || obj.Name() != symbolName {
					return true
				}
				if loc, ok := toLocation(workspaceRoot, pkg, ident, "definition", roleFor(obj), highConf); ok {
					output = append(output, loc)
				}
				return true
			})
		}
	}
	return dedupeAndSort(output)
}

func findReferences(workspaceRoot string, symbolName string, pkgs []*packages.Package) []SymbolLocation {
	bound := make(map[types.Object]bool)
	defPositions := make(map[token.Pos]bool)
	output := make([]SymbolLocation, 0)

	for _, pkg := range pkgs {
		for _, file := range pkg.Syntax {
			ast.Inspect(file, func(n ast.Node) bool {
				ident, ok := n.(*ast.Ident)
				if !ok {
					return true
				}
				obj := pkg.TypesInfo.Defs[ident]
				if obj != nil && obj.Name() == symbolName {
					bound[obj] = true
					defPositions[ident.Pos()] = true
					if loc, ok := toLocation(workspaceRoot, pkg, ident, "definition", "definition-reference", highConf); ok {
						output = append(output, loc)
					}
				}
				return true
			})
		}
	}

	for _, pkg := range pkgs {
		for _, file := range pkg.Syntax {
			ast.Inspect(file, func(n ast.Node) bool {
				ident, ok := n.(*ast.Ident)
				if !ok {
					return true
				}
				obj := pkg.TypesInfo.Uses[ident]
				if obj == nil || !bound[obj] || defPositions[ident.Pos()] {
					return true
				}
				if loc, ok := toLocation(workspaceRoot, pkg, ident, "reference", "reference", mediumConf); ok {
					output = append(output, loc)
				}
				return true
			})
		}
	}
	return dedupeAndSort(output)
}

func roleFor(obj types.Object) string {
	switch o := obj.(type) {
	case *types.Func:
		if o.Signature().Recv() != nil {
			return "method"
		}
		return "func"
	case *types.TypeName:
		if o.IsAlias() {
			return "alias"
		}
		switch o.Type().Underlying().(type) {
		case *types.Struct:
			return "struct"
		case *types.Interface:
			return "interface"
		}
		return "type"
	case *types.Var:
		if o.IsField() {
			return "field"
		}
		return "var"
	case *types.Const:
		return "const"
	case *types.PkgName:
		return "pkg"
	}
	return "symbol"
}

func toLocation(workspaceRoot string, pkg *packages.Package, ident *ast.Ident, kind string, role string, confidence string) (SymbolLocation, bool) {
	pos := pkg.Fset.Position(ident.Pos())
	if !pos.IsValid() {
		return SymbolLocation{}, false
	}
	rel, ok := relativeWithinWorkspace(workspaceRoot, pos.Filename)
	if !ok {
		return SymbolLocation{}, false
	}
	return SymbolLocation{
		Language:     langGo,
		Symbol:       ident.Name,
		Kind:         kind,
		Role:         role,
		RelativePath: rel,
		Line:         pos.Line,
		Column:       pos.Column,
		Confidence:   confidence,
		Source:       sourceGo,
	}, true
}

func relativeWithinWorkspace(workspaceRoot string, filename string) (string, bool) {
	abs, err := filepath.Abs(filename)
	if err != nil {
		return "", false
	}
	rel, err := filepath.Rel(workspaceRoot, abs)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	for _, segment := range strings.Split(rel, "/") {
		if excludedDirSegments[segment] {
			return "", false
		}
	}
	return rel, true
}

func dedupeAndSort(locations []SymbolLocation) []SymbolLocation {
	byKey := make(map[string]SymbolLocation)
	for _, loc := range locations {
		key := fmt.Sprintf("%s:%d:%d:%s:%s", loc.RelativePath, loc.Line, loc.Column, loc.Kind, loc.Role)
		if _, exists := byKey[key]; !exists {
			byKey[key] = loc
		}
	}
	output := make([]SymbolLocation, 0, len(byKey))
	for _, loc := range byKey {
		output = append(output, loc)
	}
	sort.Slice(output, func(i, j int) bool {
		a, b := output[i], output[j]
		if a.RelativePath != b.RelativePath {
			return a.RelativePath < b.RelativePath
		}
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		if a.Column != b.Column {
			return a.Column < b.Column
		}
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		return a.Role < b.Role
	})
	return output
}
