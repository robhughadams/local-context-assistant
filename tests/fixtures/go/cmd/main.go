package main

import (
	"fmt"

	"example.com/lca-fixture/greeting"
)

func main() {
	g := greeting.NewGreeter(greeting.DefaultName)
	fmt.Println(g.Hello())
}