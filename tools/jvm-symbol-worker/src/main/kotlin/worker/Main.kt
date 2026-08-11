package worker

import kotlin.system.exitProcess

const val PROTOCOL_VERSION = 1

fun main() {
    val input = System.`in`.readBytes().decodeToString()
    val response = try {
        execute(Protocol.parseRequest(input))
    } catch (e: Exception) {
        errorResponse(e.message ?: "unexpected worker failure")
    }
    println(Protocol.renderResponse(response))
    if (!response.ok) {
        exitProcess(1)
    }
}

fun execute(request: WorkerRequest): WorkerResponse {
    if (request.version != PROTOCOL_VERSION) {
        return errorResponse("Unsupported protocol version ${request.version}. Expected $PROTOCOL_VERSION.")
    }
    if (request.mode != "find" && request.mode != "refs") {
        return errorResponse("Invalid mode '${request.mode}'. Expected 'find' or 'refs'.")
    }
    if (request.symbol.isBlank()) {
        return errorResponse("Symbol text is required.")
    }
    if (request.language !in Protocol.SUPPORTED_LANGUAGES) {
        return errorResponse("Unsupported language '${request.language}'. Expected 'java' or 'kotlin'.")
    }
    if (!java.nio.file.Files.isDirectory(java.nio.file.Path.of(request.workspaceRoot))) {
        return errorResponse("Workspace root is not a directory: ${request.workspaceRoot}")
    }
    val results = when (request.language) {
        "java" -> {
            val resolver = JavaResolver(request.workspaceRoot)
            if (request.mode == "find") resolver.find(request.symbol) else resolver.refs(request.symbol)
        }
        "kotlin" -> {
            val resolver = KotlinResolver(request.workspaceRoot)
            if (request.mode == "find") resolver.find(request.symbol) else resolver.refs(request.symbol)
        }
        else -> emptyList()
    }
    return WorkerResponse(true, results, null)
}