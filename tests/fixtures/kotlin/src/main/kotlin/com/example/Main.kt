package com.example

fun main() {
    val greeter = Registry.newGreeter("world")
    println(greeter.hello())
}