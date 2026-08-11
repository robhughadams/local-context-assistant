package main

type WorkerRequest struct {
	Version       int    `json:"version"`
	Mode          string `json:"mode"`
	Symbol        string `json:"symbol"`
	WorkspaceRoot string `json:"workspaceRoot"`
}

type SymbolLocation struct {
	Language     string `json:"language"`
	Symbol       string `json:"symbol"`
	Kind         string `json:"kind"`
	Role         string `json:"role"`
	RelativePath string `json:"relativePath"`
	Line         int    `json:"line"`
	Column       int    `json:"column"`
	Confidence   string `json:"confidence"`
	Source       string `json:"source"`
}

type WorkerResponse struct {
	Ok      bool             `json:"ok"`
	Results []SymbolLocation `json:"results"`
	Error   string           `json:"error,omitempty"`
}

const protocolVersion = 1

func errorResponse(message string) WorkerResponse {
	return WorkerResponse{Ok: false, Error: message}
}
