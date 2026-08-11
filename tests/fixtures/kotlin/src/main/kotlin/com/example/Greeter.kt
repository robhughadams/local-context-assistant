package com.example

data class Greeter(val name: String) {
    fun hello(): String = "Hello, $name"
}

object Registry {
    fun newGreeter(name: String): Greeter = Greeter(name)
}