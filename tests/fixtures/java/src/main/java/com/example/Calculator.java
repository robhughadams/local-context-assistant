package com.example;

public class Calculator {
    private int total;

    public int add(int value) {
        total += value;
        return total;
    }

    public int getTotal() {
        return total;
    }
}