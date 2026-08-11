package worker

import com.github.javaparser.JavaParser
import com.github.javaparser.ParserConfiguration
import com.github.javaparser.ast.CompilationUnit
import com.github.javaparser.ast.Node
import com.github.javaparser.ast.body.ConstructorDeclaration
import com.github.javaparser.ast.body.EnumConstantDeclaration
import com.github.javaparser.ast.body.FieldDeclaration
import com.github.javaparser.ast.body.MethodDeclaration
import com.github.javaparser.ast.body.Parameter
import com.github.javaparser.ast.body.RecordDeclaration
import com.github.javaparser.ast.body.TypeDeclaration
import com.github.javaparser.ast.body.VariableDeclarator
import com.github.javaparser.ast.expr.FieldAccessExpr
import com.github.javaparser.ast.expr.MethodCallExpr
import com.github.javaparser.ast.expr.NameExpr
import com.github.javaparser.ast.expr.ObjectCreationExpr
import com.github.javaparser.ast.expr.VariableDeclarationExpr
import com.github.javaparser.resolution.Resolvable
import com.github.javaparser.resolution.declarations.ResolvedAnnotationDeclaration
import com.github.javaparser.resolution.declarations.ResolvedConstructorDeclaration
import com.github.javaparser.resolution.declarations.ResolvedDeclaration
import com.github.javaparser.resolution.declarations.ResolvedEnumConstantDeclaration
import com.github.javaparser.resolution.declarations.ResolvedMethodDeclaration
import com.github.javaparser.resolution.declarations.ResolvedValueDeclaration
import com.github.javaparser.symbolsolver.JavaSymbolSolver
import com.github.javaparser.symbolsolver.resolution.typesolvers.ClassLoaderTypeSolver
import com.github.javaparser.symbolsolver.resolution.typesolvers.CombinedTypeSolver
import com.github.javaparser.symbolsolver.resolution.typesolvers.JavaParserTypeSolver
import com.github.javaparser.symbolsolver.resolution.typesolvers.ReflectionTypeSolver
import java.io.File
import java.net.URLClassLoader
import java.nio.file.Path

class JavaResolver(private val workspaceRoot: String) {

    private val rootPath = Path.of(workspaceRoot).toAbsolutePath()
    private val sourceCollector = SourceCollector()
    private val parser = JavaParser(
        ParserConfiguration()
            .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21)
            .setSymbolResolver(JavaSymbolSolver(buildTypeSolver()))
    )

    private val output = mutableListOf<SymbolLocation>()
    private val definitionKeys = mutableSetOf<String>()
    private var resolvedUnits: List<CompilationUnit> = emptyList()

    private fun buildTypeSolver(): CombinedTypeSolver {
        val solver = CombinedTypeSolver()
        for (sourceRoot in sourceRoots()) {
            solver.add(JavaParserTypeSolver(sourceRoot.toFile()))
        }
        solver.add(ReflectionTypeSolver(true))
        val jars = mavenClasspathJars()
        if (jars.isNotEmpty()) {
            solver.add(ClassLoaderTypeSolver(URLClassLoader(jars.map { it.toURL() }.toTypedArray())))
        }
        return solver
    }

    private fun sourceRoots(): List<Path> {
        val standard = listOf(
            rootPath.resolve("src/main/java"),
            rootPath.resolve("src/test/java")
        ).filter { containsJavaFiles(it) }
        if (standard.isNotEmpty()) {
            return standard
        }
        return if (containsJavaFiles(rootPath)) {
            listOf(rootPath)
        } else {
            emptyList()
        }
    }

    private fun containsJavaFiles(dir: Path): Boolean =
        dir.toFile().walkTopDown().any { it.isFile && it.name.endsWith(".java") }

    private fun mavenClasspathJars(): List<File> {
        val pom = rootPath.resolve("pom.xml")
        if (!pom.toFile().isFile || !fileOnPath("mvn")) {
            return emptyList()
        }
        return try {
            val outputPath = File.createTempFile("lca-classpath", ".txt")
            val process = ProcessBuilder(
                "mvn", "-q", "-f", pom.toString(),
                "dependency:build-classpath", "-Dmdep.outputFile=${outputPath.absolutePath}"
            ).start()
            if (!process.waitFor(120, java.util.concurrent.TimeUnit.SECONDS)) {
                emptyList()
            } else if (process.exitValue() != 0) {
                emptyList()
            } else {
                outputPath.readLines()
                    .flatMap { it.split(File.pathSeparatorChar) }
                    .filter { it.isNotBlank() && File(it).isFile }
                    .map { File(it) }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun fileOnPath(name: String): Boolean =
        System.getenv("PATH").orEmpty().split(File.pathSeparatorChar).any { File(it, name).isFile }

    fun find(symbolName: String): List<SymbolLocation> {
        parseAll()
        for (unit in resolvedUnits) {
            unit.walk { node: Node ->
                val decl = declarationOf(node) ?: return@walk
                if (decl.nameNode.asString() != symbolName) {
                    return@walk
                }
                emitDefinition(decl)
            }
        }
        return sorted(output)
    }

    fun refs(symbolName: String): List<SymbolLocation> {
        parseAll()
        for (unit in resolvedUnits) {
            unit.walk { node: Node ->
                val decl = declarationOf(node) ?: return@walk
                if (decl.nameNode.asString() != symbolName) {
                    return@walk
                }
                emitDefinition(decl, "definition-reference")
            }
        }
        for (unit in resolvedUnits) {
            unit.walk { node: Node ->
                val expr = referenceExpression(node) ?: return@walk
                val resolved = resolveDeclaration(expr) ?: return@walk
                val targetKey = resolutionKey(resolved) ?: return@walk
                if (targetKey !in definitionKeys) {
                    return@walk
                }
                val begin = referenceNameOf(expr).begin.orElse(null) ?: return@walk
                emit(unit, begin.line, begin.column, symbolName, "reference", "reference", "medium")
            }
        }
        return sorted(output)
    }

    private data class Decl(val marker: Node, val nameNode: com.github.javaparser.ast.expr.SimpleName, val role: String)

    private fun declarationOf(node: Node): Decl? = when (node) {
        is TypeDeclaration<*> -> Decl(node, node.name, roleForType(node))
        is ConstructorDeclaration -> Decl(node, node.name, "constructor")
        is MethodDeclaration -> Decl(node, node.name, "method")
        is FieldDeclaration -> node.variables.firstOrNull()?.let { Decl(it, it.name, "field") }
        is Parameter -> Decl(node, node.name, "parameter")
        is EnumConstantDeclaration -> Decl(node, node.name, "enum-entry")
        is VariableDeclarationExpr -> node.variables.firstOrNull()?.let { Decl(it, it.name, "local") }
        else -> null
    }

    private fun roleForType(node: TypeDeclaration<*>): String = when (node) {
        is com.github.javaparser.ast.body.ClassOrInterfaceDeclaration -> if (node.isInterface) "interface" else "class"
        is com.github.javaparser.ast.body.EnumDeclaration -> "enum"
        is com.github.javaparser.ast.body.AnnotationDeclaration -> "annotation"
        is RecordDeclaration -> "record"
        else -> "class"
    }

    private fun referenceExpression(node: Node): Node? = when (node) {
        is NameExpr -> node
        is MethodCallExpr -> node
        is FieldAccessExpr -> node
        is ObjectCreationExpr -> node
        else -> null
    }

    private fun referenceNameOf(node: Node): com.github.javaparser.ast.expr.SimpleName = when (node) {
        is NameExpr -> node.name
        is MethodCallExpr -> node.name
        is FieldAccessExpr -> node.name
        is ObjectCreationExpr -> node.type.name
        else -> throw IllegalArgumentException("unsupported reference node")
    }

    private fun resolveDeclaration(node: Node): ResolvedDeclaration? {
        val resolvable = node as? Resolvable<*> ?: return null
        return try {
            resolvable.resolve() as? ResolvedDeclaration
        } catch (_: Throwable) {
            null
        }
    }

    private fun resolutionKey(resolved: ResolvedDeclaration): String? = try {
        when (resolved) {
            is ResolvedMethodDeclaration -> "method:" + resolved.qualifiedName
            is ResolvedConstructorDeclaration -> {
                val declaring = resolved.declaringType().qualifiedName
                val params = (0 until resolved.numberOfParams)
                    .map { resolved.getParam(it).describeType() }
                    .joinToString(",")
                "constructor:$declaring($params)"
            }
            is ResolvedEnumConstantDeclaration -> "enum:" + resolved.name
            is ResolvedAnnotationDeclaration -> "annotation:" + resolved.qualifiedName
            is com.github.javaparser.resolution.declarations.ResolvedReferenceTypeDeclaration ->
                "type:" + resolved.qualifiedName
            is com.github.javaparser.resolution.declarations.ResolvedFieldDeclaration -> {
                val declaring = resolved.declaringType().qualifiedName
                "field:$declaring.${resolved.name}"
            }
            is com.github.javaparser.resolution.declarations.ResolvedParameterDeclaration -> "param:" + resolved.name
            is ResolvedValueDeclaration -> "value:" + resolved.name
            else -> null
        }
    } catch (_: Throwable) {
        null
    }

    private fun emitDefinition(decl: Decl, role: String = decl.role) {
        val begin = decl.nameNode.begin.orElse(null) ?: return
        val unit = decl.nameNode.findCompilationUnit().orElse(null) ?: return
        val resolved = resolveDeclaration(decl.marker)
        val key = if (resolved != null) {
            resolutionKey(resolved)
        } else {
            markerKey(decl.nameNode)
        } ?: return
        definitionKeys.add(key)
        emit(unit, begin.line, begin.column, decl.nameNode.asString(), "definition", role, "high")
    }

    private fun markerKey(node: Node): String? {
        val unit = node.findCompilationUnit().orElse(null) ?: return null
        val unitKey = unitKeyOf(unit) ?: return null
        val begin = node.nameProperty()?.begin?.orElse(null) ?: return null
        return "$unitKey:${begin.line}-${begin.column}"
    }

    private fun unitKeyOf(unit: CompilationUnit): String? {
        val absolute = unit.storage.map { it.path.toAbsolutePath() }.orElse(null) ?: return null
        return rootPath.relativize(absolute.normalize()).toString().replace(File.separatorChar, '/')
    }

    private fun Node.nameProperty(): com.github.javaparser.ast.expr.SimpleName? = when (this) {
        is com.github.javaparser.ast.expr.SimpleName -> this
        is com.github.javaparser.ast.body.TypeDeclaration<*> -> name
        is ConstructorDeclaration -> name
        is MethodDeclaration -> name
        is VariableDeclarator -> name
        is Parameter -> name
        is EnumConstantDeclaration -> name
        is FieldDeclaration -> variables.firstOrNull()?.name
        is VariableDeclarationExpr -> variables.firstOrNull()?.name
        else -> null
    }

    private fun emit(
        unit: CompilationUnit,
        line: Int,
        column: Int,
        symbol: String,
        kind: String,
        role: String,
        confidence: String
    ) {
        val absolute = unit.storage.map { it.path.toAbsolutePath() }.orElse(null) ?: return
        val relative = rootPath.relativize(absolute.normalize()).toString().replace(File.separatorChar, '/')
        output += SymbolLocation(
            language = "java",
            symbol = symbol,
            kind = kind,
            role = role,
            relativePath = relative,
            line = line,
            column = column,
            confidence = confidence,
            source = "javaparser-symbol-solver"
        )
    }

    private fun parseAll() {
        if (resolvedUnits.isNotEmpty()) {
            return
        }
        resolvedUnits = sourceCollector.collect(workspaceRoot, ".java").mapNotNull { path ->
            try {
                parser.parse(path.toFile()).result.orElse(null)
            } catch (_: Exception) {
                null
            }
        }
    }

    private fun sorted(locations: List<SymbolLocation>): List<SymbolLocation> {
        val byKey = mutableMapOf<String, SymbolLocation>()
        for (loc in locations) {
            val key = "${loc.relativePath}:${loc.line}:${loc.column}:${loc.kind}:${loc.role}"
            byKey.putIfAbsent(key, loc)
        }
        return byKey.values.sortedWith(compareBy({ it.relativePath }, { it.line }, { it.column }, { it.kind }, { it.role }))
    }
}