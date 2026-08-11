package worker

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File
import java.nio.file.Files
import java.nio.file.Path

data class SymbolLocation(
    val language: String,
    val symbol: String,
    val kind: String,
    val role: String,
    val relativePath: String,
    val line: Int,
    val column: Int,
    val confidence: String,
    val source: String
)

data class WorkerResponse(val ok: Boolean, val results: List<SymbolLocation>, val error: String?)

fun errorResponse(message: String): WorkerResponse = WorkerResponse(false, emptyList(), message)

object Protocol {

    val SUPPORTED_LANGUAGES = setOf("java", "kotlin")

    fun parseRequest(input: String): WorkerRequest {
        val root: JsonObject = JsonParser.parseString(input).asJsonObject
        return WorkerRequest(
            version = root.get("version")?.asInt ?: 0,
            language = root.get("language")?.asString ?: "",
            mode = root.get("mode")?.asString ?: "",
            symbol = root.get("symbol")?.asString ?: "",
            workspaceRoot = root.get("workspaceRoot")?.asString ?: ""
        )
    }

    fun renderResponse(response: WorkerResponse): String {
        val root = JsonObject()
        root.addProperty("ok", response.ok)
        val results = com.google.gson.JsonArray()
        for (loc in response.results) {
            val item = JsonObject()
            item.addProperty("language", loc.language)
            item.addProperty("symbol", loc.symbol)
            item.addProperty("kind", loc.kind)
            item.addProperty("role", loc.role)
            item.addProperty("relativePath", loc.relativePath)
            item.addProperty("line", loc.line)
            item.addProperty("column", loc.column)
            item.addProperty("confidence", loc.confidence)
            item.addProperty("source", loc.source)
            results.add(item)
        }
        root.add("results", results)
        root.addProperty("error", response.error)
        return root.toString()
    }
}

data class WorkerRequest(
    val version: Int,
    val language: String,
    val mode: String,
    val symbol: String,
    val workspaceRoot: String
)

class SourceCollector {

    private val excludedSegments = setOf(
        ".git", "node_modules", "dist", ".lca", "coverage", "build", "bin", "obj", "target"
    )

    fun collect(workspaceRoot: String, extension: String): List<Path> {
        val root = Path.of(workspaceRoot).toAbsolutePath()
        if (!Files.isDirectory(root)) {
            throw IllegalArgumentException("Workspace root is not a directory: $root")
        }
        val output = mutableListOf<Path>()
        walk(root, root, extension, output)
        return output.sortedBy { it.toString() }
    }

    private fun walk(root: Path, current: Path, extension: String, output: MutableList<Path>) {
        val entries = current.toFile().listFiles()?.sortedBy { it.name } ?: return
        for (entry in entries) {
            val path = entry.toPath()
            if (entry.isDirectory) {
                if (entry.name in excludedSegments) {
                    continue
                }
                walk(root, path, extension, output)
            } else if (entry.isFile && entry.name.endsWith(extension)) {
                output.add(path)
            }
        }
    }

    fun relativeTo(workspaceRoot: String, path: Path): String =
        Path.of(workspaceRoot).toAbsolutePath().relativize(path.toAbsolutePath()).toString().replace(File.separatorChar, '/')
}