package greeting

type Greeter struct {
	Name string
}

func NewGreeter(name string) Greeter {
	return Greeter{Name: name}
}

func (g Greeter) Hello() string {
	return "Hello, " + g.Name
}

const DefaultName = "world"