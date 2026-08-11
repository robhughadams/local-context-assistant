plugins {
    kotlin("jvm") version "2.2.20"
    application
    id("com.github.johnrengelman.shadow") version "8.1.1"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.github.javaparser:javaparser-symbol-solver-core:3.27.0")
    implementation("org.jetbrains.kotlin:kotlin-compiler-embeddable:2.2.20")
    implementation("com.google.code.gson:gson:2.11.0")
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("worker.MainKt")
}

tasks.shadowJar {
    archiveFileName.set("symbol-worker.jar")
}

tasks.test {
    useJUnitPlatform()
    maxHeapSize = "1g"
}