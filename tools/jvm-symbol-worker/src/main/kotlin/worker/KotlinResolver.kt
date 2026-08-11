package worker

import org.jetbrains.kotlin.analyzer.AnalysisResult
import org.jetbrains.kotlin.cli.common.messages.MessageCollector
import org.jetbrains.kotlin.cli.jvm.compiler.EnvironmentConfigFiles
import org.jetbrains.kotlin.cli.jvm.compiler.JvmPackagePartProvider
import org.jetbrains.kotlin.cli.jvm.compiler.KotlinCoreEnvironment
import org.jetbrains.kotlin.cli.jvm.compiler.TopDownAnalyzerFacadeForJVM
import org.jetbrains.kotlin.com.intellij.openapi.util.Disposer
import org.jetbrains.kotlin.com.intellij.psi.util.PsiTreeUtil
import org.jetbrains.kotlin.config.ApiVersion
import org.jetbrains.kotlin.config.CommonConfigurationKeys
import org.jetbrains.kotlin.config.CompilerConfiguration
import org.jetbrains.kotlin.config.LanguageVersion
import org.jetbrains.kotlin.config.LanguageVersionSettingsImpl
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtEnumEntry
import org.jetbrains.kotlin.psi.KtFile
import org.jetbrains.kotlin.psi.KtNamedDeclaration
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.psi.KtObjectDeclaration
import org.jetbrains.kotlin.psi.KtParameter
import org.jetbrains.kotlin.psi.KtPrimaryConstructor
import org.jetbrains.kotlin.psi.KtProperty
import org.jetbrains.kotlin.psi.KtSecondaryConstructor
import org.jetbrains.kotlin.psi.KtTypeAlias
import org.jetbrains.kotlin.psi.KtTypeParameter
import org.jetbrains.kotlin.resolve.BindingContext
import org.jetbrains.kotlin.resolve.lazy.declarations.FileBasedDeclarationProviderFactory
import java.io.File
import java.util.Collections
import java.util.IdentityHashMap

@Suppress("DEPRECATION")
class KotlinResolver(private val workspaceRoot: String) {

    private val sourceCollector = SourceCollector()
    private val output = mutableListOf<SymbolLocation>()

    private lateinit var bindingContext: BindingContext
    private var files: List<KtFile> = emptyList()

    fun find(symbolName: String): List<SymbolLocation> {
        analyze()
        withDefinitions(symbolName, emit = true)
        return sorted(output)
    }

    fun refs(symbolName: String): List<SymbolLocation> {
        analyze()
        val found = withDefinitions(symbolName, emit = true)
        val foundDescriptors = HashSet<org.jetbrains.kotlin.descriptors.DeclarationDescriptor>()
        for ((declaration, _) in found) {
            bindingContext[BindingContext.DECLARATION_TO_DESCRIPTOR, declaration]?.let { foundDescriptors.add(it) }
        }
        val definitionOffsets = found.map { it.second }.toSet()
        for ((expression, descriptor) in bindingContext.getSliceContents(BindingContext.REFERENCE_TARGET)) {
            if (descriptor !in foundDescriptors) {
                continue
            }
            val file = expression.containingFile as? KtFile ?: continue
            val offset = expression.textRange.startOffset
            if (offset in definitionOffsets) {
                continue
            }
            emit(
                file,
                position(file, offset),
                symbolName,
                "reference",
                "reference",
                "medium"
            )
        }
        return sorted(output)
    }

    private fun withDefinitions(symbolName: String, emit: Boolean): List<Pair<KtNamedDeclaration, Int>> {
        val found = mutableListOf<Pair<KtNamedDeclaration, Int>>()
        for (file in files) {
            for (declaration in PsiTreeUtil.findChildrenOfType(file, KtNamedDeclaration::class.java)) {
                val nameIdentifier = declaration.nameIdentifier ?: continue
                if (declaration.name != symbolName) {
                    continue
                }
                val offset = nameIdentifier.textRange.startOffset
                found += declaration to offset
                if (emit) {
                    emitDefinition(file, declaration, offset, symbolName)
                }
            }
        }
        return found
    }

    private fun emitDefinition(file: KtFile, declaration: KtNamedDeclaration, offset: Int, symbolName: String) {
        emit(file, position(file, offset), symbolName, "definition", roleFor(declaration), "high")
    }

    private fun roleFor(declaration: KtNamedDeclaration): String = when (declaration) {
        is KtClass -> when {
            declaration.isInterface() -> "interface"
            declaration.isEnum() -> "enum"
            declaration.isSealed() -> "sealed"
            declaration.isAnnotation() -> "annotation"
            declaration.isData() -> "data-class"
            else -> "class"
        }
        is KtObjectDeclaration -> if (declaration.isCompanion()) "companion-object" else "object"
        is KtNamedFunction -> "function"
        is KtProperty -> if (declaration.isLocal) "local" else "property"
        is KtSecondaryConstructor -> "constructor"
        is KtPrimaryConstructor -> "constructor"
        is KtParameter -> "parameter"
        is KtTypeAlias -> "type-alias"
        is KtEnumEntry -> "enum-entry"
        is KtTypeParameter -> "type-parameter"
        else -> "declaration"
    }

    private fun position(file: KtFile, offset: Int): Pair<Int, Int> {
        val document = file.viewProvider.document ?: return 1 to 1
        val line = document.getLineNumber(offset)
        return (line + 1) to (offset - document.getLineStartOffset(line) + 1)
    }

    private fun emit(file: KtFile, position: Pair<Int, Int>, symbol: String, kind: String, role: String, confidence: String) {
        val absolute = File(file.viewProvider.virtualFile.path).toPath().toAbsolutePath()
        val root = File(workspaceRoot).toPath().toAbsolutePath()
        val relative = root.relativize(absolute.normalize()).toString().replace(File.separatorChar, '/')
        output += SymbolLocation(
            language = "kotlin",
            symbol = symbol,
            kind = kind,
            role = role,
            relativePath = relative,
            line = position.first,
            column = position.second,
            confidence = confidence,
            source = "kotlin-compiler"
        )
    }

    private fun analyze() {
        if (this::bindingContext.isInitialized) {
            return
        }
        val sourceFiles = sourceCollector.collect(workspaceRoot, ".kt")
        if (sourceFiles.isEmpty()) {
            bindingContext = BindingContext.EMPTY
            files = emptyList()
            return
        }
        val disposable = Disposer.newDisposable("lca-kotlin-analysis")
        val configuration = CompilerConfiguration()
        configuration.put(CommonConfigurationKeys.MESSAGE_COLLECTOR_KEY, MessageCollector.NONE)
        configuration.put(CommonConfigurationKeys.MODULE_NAME, "lca-workspace")
        val environment = KotlinCoreEnvironment.createForProduction(disposable, configuration, EnvironmentConfigFiles.JVM_CONFIG_FILES)
        environment.addKotlinSourceRoots(sourceFiles.map { it.toFile() })
        files = environment.getSourceFiles()
        if (files.isEmpty()) {
            bindingContext = BindingContext.EMPTY
            return
        }
        val trace = org.jetbrains.kotlin.cli.jvm.compiler.CliBindingTrace(environment.project)
        val result: AnalysisResult = TopDownAnalyzerFacadeForJVM.analyzeFilesWithJavaIntegration(
            project = environment.project,
            files = files,
            trace = trace,
            configuration = configuration,
            packagePartProvider = {
                JvmPackagePartProvider(
                    LanguageVersionSettingsImpl(
                        LanguageVersion.LATEST_STABLE,
                        ApiVersion.LATEST_STABLE,
                        emptyMap()
                    ),
                    it
                )
            },
            declarationProviderFactory = { storageManager, workspaceFiles ->
                FileBasedDeclarationProviderFactory(storageManager, workspaceFiles)
            }
        )
        bindingContext = result.bindingContext
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