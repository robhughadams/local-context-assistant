package worker

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private val fixtureRoots = mapOf(
    "java" to System.getProperty("user.dir").let { dir ->
        java.nio.file.Path.of(dir, "..", "..", "tests", "fixtures", "java").normalize()
    },
    "kotlin" to System.getProperty("user.dir").let { dir ->
        java.nio.file.Path.of(dir, "..", "..", "tests", "fixtures", "kotlin").normalize()
    }
)

class ProtocolTest {

    @Test
    fun rejectsUnsupportedVersion() {
        val response = execute(WorkerRequest(version = 99, language = "java", mode = "find", symbol = "Foo", workspaceRoot = "/tmp"))
        assertFalse(response.ok)
        assertNotNull(response.error)
        assertTrue(response.error!!.contains("version"))
    }

    @Test
    fun rejectsInvalidMode() {
        val response = execute(WorkerRequest(version = 1, language = "java", mode = "grep", symbol = "Foo", workspaceRoot = "/tmp"))
        assertFalse(response.ok)
        assertTrue(response.error!!.contains("grep"))
    }

    @Test
    fun rejectsBlankSymbol() {
        val response = execute(WorkerRequest(version = 1, language = "java", mode = "find", symbol = "  ", workspaceRoot = "/tmp"))
        assertFalse(response.ok)
        assertTrue(response.error!!.contains("Symbol text is required"))
    }

    @Test
    fun rejectsUnsupportedLanguage() {
        val response = execute(WorkerRequest(version = 1, language = "rust", mode = "find", symbol = "Foo", workspaceRoot = "/tmp"))
        assertFalse(response.ok)
        assertTrue(response.error!!.contains("rust"))
    }

    @Test
    fun rejectsMissingWorkspace() {
        val response = execute(WorkerRequest(version = 1, language = "java", mode = "find", symbol = "Foo", workspaceRoot = "/nonexistent"))
        assertFalse(response.ok)
        assertNotNull(response.error)
    }
}

class JavaResolverTest {

    private fun root(): String = fixtureRoots.getValue("java").toString()

    @Test
    fun findClassReturnsClassDefinition() {
        val response = execute(WorkerRequest(version = 1, language = "java", mode = "find", symbol = "Calculator", workspaceRoot = root()))
        assertTrue(response.ok, "error: ${response.error}")
        assertEquals(1, response.results.size)
        val loc = response.results[0]
        assertEquals("java", loc.language)
        assertEquals("definition", loc.kind)
        assertEquals("class", loc.role)
        assertEquals("high", loc.confidence)
        assertEquals("src/main/java/com/example/Calculator.java", loc.relativePath)
        assertTrue(loc.line >= 1 && loc.column >= 1)
    }

    @Test
    fun findMethodReturnsMethod() {
        val response = execute(WorkerRequest(version = 1, language = "java", mode = "find", symbol = "getTotal", workspaceRoot = root()))
        assertTrue(response.ok, "error: ${response.error}")
        assertEquals(1, response.results.size)
        assertEquals("method", response.results[0].role)
    }

    @Test
    fun refsIncludeUsageAcrossFiles() {
        val response = execute(WorkerRequest(version = 1, language = "java", mode = "refs", symbol = "add", workspaceRoot = root()))
        assertTrue(response.ok, "error: ${response.error}")
        val usage = response.results.firstOrNull { it.relativePath.contains("Main.java") }
        assertNotNull(usage, "expected usage in Main.java, got ${response.results}")
        assertEquals("reference", usage.kind)
        assertEquals("medium", usage.confidence)
        val definition = response.results.firstOrNull { it.kind == "definition" }
        assertNotNull(definition)
        assertEquals("definition-reference", definition.role)
    }

    @Test
    fun unknownSymbolReturnsEmptyResults() {
        val response = execute(WorkerRequest(version = 1, language = "java", mode = "find", symbol = "DoesNotExist", workspaceRoot = root()))
        assertTrue(response.ok)
        assertTrue(response.results.isEmpty())
    }
}

class KotlinResolverTest {

    private fun root(): String = fixtureRoots.getValue("kotlin").toString()

    @Test
    fun findDataClassReturnsDataClass() {
        val response = execute(WorkerRequest(version = 1, language = "kotlin", mode = "find", symbol = "Greeter", workspaceRoot = root()))
        assertTrue(response.ok, "error: ${response.error}")
        assertEquals(1, response.results.size)
        val loc = response.results[0]
        assertEquals("kotlin", loc.language)
        assertEquals("definition", loc.kind)
        assertEquals("data-class", loc.role)
        assertEquals("high", loc.confidence)
        assertEquals("src/main/kotlin/com/example/Greeter.kt", loc.relativePath)
    }

    @Test
    fun findFunctionInObject() {
        val response = execute(WorkerRequest(version = 1, language = "kotlin", mode = "find", symbol = "newGreeter", workspaceRoot = root()))
        assertTrue(response.ok, "error: ${response.error}")
        assertEquals(1, response.results.size)
        assertEquals("function", response.results[0].role)
    }

    @Test
    fun refsIncludeUsageAcrossFiles() {
        val response = execute(WorkerRequest(version = 1, language = "kotlin", mode = "refs", symbol = "newGreeter", workspaceRoot = root()))
        assertTrue(response.ok, "error: ${response.error}")
        val usage = response.results.firstOrNull { it.relativePath.contains("Main.kt") }
        assertNotNull(usage, "expected usage in Main.kt, got ${response.results}")
        assertEquals("reference", usage.kind)
        assertEquals("medium", usage.confidence)
    }

    @Test
    fun refsForConstructorFunctionUsage() {
        val response = execute(WorkerRequest(version = 1, language = "kotlin", mode = "refs", symbol = "hello", workspaceRoot = root()))
        assertTrue(response.ok, "error: ${response.error}")
        val usage = response.results.firstOrNull { it.relativePath.contains("Main.kt") }
        assertNotNull(usage, "expected usage in Main.kt, got ${response.results}")
    }
}