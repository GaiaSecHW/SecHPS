# codedmap/pipeline/orchestrator.py

import logging
import shutil
from pathlib import Path
from typing import Optional, List, Type

from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.core.schema.graph.enums import NodeLabel, EdgeType
from codedmap.infra.storage.store import CPGStore
from codedmap.infra.storage.driver_neo4j.bulk.command import ImportScriptGenerator
from codedmap.infra.executor.runner import ThreadPoolRunner, ProcessPoolRunner, SequentialRunner
from codedmap.analysis.passes.manager import PassManager
from codedmap.pipeline.frontend import FrontendPipeline, FrontendConfig

# Passes (Batch)
from codedmap.analysis.passes.batch.global_points_to import GlobalPointsToPass
from codedmap.analysis.passes.batch.call_graph import CallGraphPass
from codedmap.analysis.passes.batch.pdg import PDGPass
from codedmap.analysis.passes.batch.global_ref import GlobalRefPass
from codedmap.analysis.passes.batch.linker import LinkerPass
from codedmap.analysis.passes.batch.entry_point_pass import EntryPointPass
from codedmap.analysis.passes.batch.source_pass import SourcePass


# AI Passes
from codedmap.analysis.passes.ai.smart_summary import SmartSummaryPass
from codedmap.analysis.passes.ai.smart_resolver import SmartGraphResolver
from codedmap.analysis.passes.ai.semantic import SemanticEmbeddingPass
from codedmap.analysis.passes.ai.smart_dataflow_tagging import SecurityTaggingPass

logger = logging.getLogger(__name__)

class PipelineOrchestrator:
    """
    [Application Entry] 顶层流水线编排器。
    负责组装 Config -> Store -> Runner -> PassManager。
    """

    def __init__(self, config_path: str = None, config: CPGConfig = None):
        if config:
            self.config = config
        else:
            # 加载默认或指定配置
            self.config = CPGConfig.load_from_yaml(config_path) if config_path else CPGConfig()

        self.store: Optional[CPGStore] = None
        self.pass_manager: Optional[PassManager] = None
        self.runner = None
        self._is_bulk_mode = False

    def _init_runner(self):
        """初始化计算资源 (Runner)"""
        if self.runner: return

        cfg = self.config.analysis
        workers = cfg.max_workers

        logger.info(f"Initializing Analysis Runner ({cfg.runner_type}, workers={workers})...")

        if cfg.runner_type == "process":
            # 进程池适合 CPU 密集型任务 (如 Embedding, heavy Regex)
            self.runner = ProcessPoolRunner(
                max_workers=workers if workers > 0 else 1,
                maxtasks_per_child=10  # 防止内存泄漏，定期重启子进程
            )
        elif cfg.runner_type == "sequential":
            # 调试模式
            self.runner = SequentialRunner()
        else:
            # 默认线程池 (适合 I/O 密集型)
            self.runner = ThreadPoolRunner(max_workers=workers)

    def _setup_intermediate_storage(self):
        if self.config.storage.use_bulk_import:
            self._is_bulk_mode = True

            interim_dir = self.config.workspace
            interim_dir.mkdir(exist_ok=True)
            db_path = interim_dir / "interim_graph.db"

            logger.info(f"🚀 Bulk Import Mode Active. Using Intermediate Storage: {db_path}")

            self.config.storage.backend = "sqlite"
            self.config.storage.uri = f"sqlite://{db_path}"

        else:
            self._is_bulk_mode = False
            logger.info(f"🚀 Standard Mode. Connected to {self.config.storage.backend}.")

        self.store = CPGStore(self.config.storage)
        self.store.init_db()

    def _force_checkpoint(self, stage_name: str):
        """
        [Infrastructure Op] 强制执行 SQLite WAL Checkpoint。

        在 Bulk 模式下，大量数据写入 WAL 文件。为了防止 WAL 无限增长并优化后续读取速度，
        我们需要在阶段转换时强制 Checkpoint。
        """
        if not self.store:
            return
        logger.info(f"[Pipeline] Triggering WAL Checkpoint after '{stage_name}'...")
        self.store.checkpoint(mode="TRUNCATE")

    def _check_base_graph_readiness(self) -> bool:
        """检查 Store 中是否已有基础图数据"""
        if not self.store:
            return False
        try:
            count = self.store.query.all_nodes(NodeLabel.METHOD).count()
            return count > 0
        except Exception:
            return False

    def _run_joern_import_phase(self):
        """Phase 1 (Joern): Import Joern Neo4j CSV export into the store."""
        logger.info(">>> PHASE 1: JOERN CSV IMPORT <<<")
        from codedmap.frontend.integrations.joern.importer import JoernCSVImporter

        jcfg = self.config.joern_import
        importer = JoernCSVImporter(
            id_strategy=jcfg.id_strategy,
            skip_unknown_labels=jcfg.skip_unknown_labels,
            skip_edge_types=jcfg.skip_edge_types,
            batch_size=jcfg.batch_size,
        )

        export_dir = str(jcfg.export_dir)
        importer.run_to_store(export_dir, self.store)
        self._force_checkpoint("Joern Import")

    def _run_ingestion_phase(self):
        """Phase 1: Frontend parsing — create FrontendPipeline and run + WAL checkpoint."""
        logger.info(">>> PHASE 1: CODE INGESTION <<<")
        frontend_config = FrontendConfig(
            parser=self.config.parser,
            storage=self.config.storage,
            ai=self.config.ai,
            pipeline=self.config.pipeline,
            dispatch=self.config.dispatch,
            project_root=self.config.project_root,
            project_name=self.config.project_name,
            workspace=self.config.workspace,
            _full_config_dict=self.config.model_dump(),
        )
        ingestor = FrontendPipeline(frontend_config, store=self.store)
        ingestor.run()
        self._force_checkpoint("Ingestion")

    def _run_analysis_phase(self, force_rerun: bool = False):
        """Phase 2: Global batch passes — init PassManager + register + run_all + WAL checkpoint."""
        logger.info(">>> PHASE 2: GLOBAL ANALYSIS <<<")
        if not self.pass_manager:
            self.pass_manager = PassManager(
                config=self.config.analysis,
                store=self.store,
                runner=self.runner,
                storage_config=self.config.storage,
                ai_config=self.config.ai,
                project_root=self.config.project_root,
                workspace=self.config.workspace,
            )
            self._register_analysis_passes()
        self.pass_manager.run_all(force_rerun=force_rerun)
        self._force_checkpoint("Global Analysis")

    def run_enhance(self, target_classes: List[Type], force_rerun: bool = False):
        """
        Run a subset of analysis passes on an existing graph (no ingestion).

        Designed for enhancing Joern-imported databases with passes that Joern
        doesn't provide (e.g., points-to analysis for resolving indirect calls).

        Args:
            target_classes: List of BatchPass classes to run.
            force_rerun: If True, re-run even if already completed.
        """
        logger.info(">>> ENHANCE: Running analysis passes on existing graph <<<")

        # 1. Environment setup
        self._init_runner()
        if not self.store:
            self._setup_intermediate_storage()

        # 2. Readiness check
        if not self._check_base_graph_readiness():
            logger.error("Base graph is empty. Import data first (e.g., Joern import or cpg build).")
            raise RuntimeError("Base graph is empty.")

        # 3. Register full DAG (needed for correct topological ordering)
        if not self.pass_manager:
            self.pass_manager = PassManager(
                config=self.config.analysis,
                store=self.store,
                runner=self.runner,
                storage_config=self.config.storage,
                ai_config=self.config.ai,
                project_root=self.config.project_root,
                workspace=self.config.workspace,
            )
            self._register_analysis_passes()

        # 4. Run only the requested subset
        logger.info(f"Target passes: {[c.__name__ for c in target_classes]}")
        self.pass_manager.run_subset(target_classes, force_rerun=force_rerun)
        self._force_checkpoint("Enhance")
        logger.info("Enhance completed.")

    def run_ai_enhancement(self, force_rerun: bool = True):
        """
        [New Feature] 仅运行 AI 语义分析流水线。

        优化点:
        1. 直接利用 PassManager.run_subset 的子集筛选能力。
        """
        logger.info("🚀 Starting AI Enhancement Pipeline...")

        # 1. 环境准备
        self._init_runner()
        if not self.store:
            self._setup_intermediate_storage()

        # 2. 健康检查
        if not self._check_base_graph_readiness():
            logger.error("❌ Base graph incomplete. Run 'run_full_pipeline' first.")
            return

        # 3. 初始化 PassManager
        # 这一步会根据 Config 注册所有启用的 Pass (构建完整的依赖 DAG)
        if not self.pass_manager:
            self.pass_manager = PassManager(
                config=self.config.analysis,
                store=self.store,
                runner=self.runner,
                storage_config=self.config.storage,
                ai_config=self.config.ai,
                project_root=self.config.project_root,
                workspace=self.config.workspace,
            )
            self._register_analysis_passes()

        # 4. 定义目标范围
        # 我们只需列出"如果是AI分析，我们想要运行哪些类"。
        # PassManager 会自动计算交集：Target ∩ Registered(Config Enabled)
        target_ai_passes = [
            SemanticEmbeddingPass,
            SmartGraphResolver,
            SmartSummaryPass,
            SecurityTaggingPass
        ]

        logger.info(f"🎯 Target Scope: {[p.__name__ for p in target_ai_passes]}")

        # 5. 执行
        # 这一步会自动处理:
        # - 依赖排序 (Topology Sort)
        # - 过滤未启用 Pass
        # - 自动 Prune (Clean-before-write)
        self.pass_manager.run_subset(target_ai_passes, force_rerun=force_rerun)

        self._force_checkpoint("AI Enhancement")
        logger.info("✅ AI Enhancement Completed.")

    def run_full_pipeline(self,
                          skip_ingestion: bool = None,
                          force_rerun: bool = False,
                          skip_analysis: bool = None,
                          skip_export: bool = None):
        """
        [One-Pass Pipeline]
        Frontend (Writes to Store) -> Analysis (R/W Store) -> [Optional] Export (Reads Store)

        参数优先级: 方法参数 > 配置文件 (PipelineConfig)。
        当参数为 None 时使用 self.config.pipeline.skip_* 的值。
        """

        # 解析有效 skip 标志 (参数覆盖配置)
        _skip_ingestion = skip_ingestion if skip_ingestion is not None else self.config.pipeline.skip_ingestion
        _skip_analysis = skip_analysis if skip_analysis is not None else self.config.pipeline.skip_analysis
        _skip_export = skip_export if skip_export is not None else self.config.pipeline.skip_export

        # 1. 准备环境
        self._init_runner()
        if not self.store:
            self._setup_intermediate_storage()

        # =========================================================
        # Phase 1: Ingestion (Frontend or Joern Import)
        # =========================================================
        if not _skip_ingestion:
            if self.config.joern_import.enabled and self.config.joern_import.export_dir:
                self._run_joern_import_phase()
            else:
                self._run_ingestion_phase()
        else:
            logger.info(">>> PHASE 1: SKIPPED (ingestion) <<<")

        # =========================================================
        # Phase 2: Analysis (Backend)
        # =========================================================
        if not _skip_analysis:
            self._run_analysis_phase(force_rerun=force_rerun)
        else:
            logger.info(">>> PHASE 2: SKIPPED (global analysis) <<<")

        # =========================================================
        # Phase 3: Export (Bulk Mode Only)
        # =========================================================
        if self._is_bulk_mode and not _skip_export:
            logger.info(">>> PHASE 3: FINAL EXPORT <<<")
            self._run_export_phase()
        elif _skip_export:
            logger.info(">>> PHASE 3: SKIPPED (export) <<<")

    def _run_export_phase(self):
        """执行数据导出 (将 SQLite 数据转换为 Neo4j Import CSV)"""
        if self.config.storage.csv_output_dir:
            csv_out_dir = Path(self.config.storage.csv_output_dir)
        else:
            csv_out_dir = self.config.project_root / "neo4j_import"

        if csv_out_dir.exists():
            logger.warning(f"Cleaning existing export dir: {csv_out_dir}")
            shutil.rmtree(csv_out_dir)
        csv_out_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Snapshotting data to: {csv_out_dir} ...")

        # 使用 Store 的 snapshot 能力
        try:
            self.store.snapshot(str(csv_out_dir))

            # 生成 Neo4j 导入脚本 (辅助运维)
            script_path = ImportScriptGenerator.generate(csv_out_dir, self.config.storage.database)
            logger.info(f"✅ Data exported successfully.")
            logger.info(f"📜 Import Script: {script_path}")

        except Exception as e:
            logger.error(f"Export failed: {e}", exc_info=True)
            raise

    def _register_analysis_passes(self):
        """
        注册 Global / Batch Passes 并定义 DAG 依赖关系。
        [Architecture Upgrade] 使用 dependencies 替代 priority。
        """
        pm = self.pass_manager
        cfg = self.config

        # =========================================================
        # Group 1: 基础拓扑 (Base Topology)
        # =========================================================
        # 1.1 精确链接器 (The Foundation)
        # 职责:
        #   1. 连接所有的变量引用 (REF) 和类型继承 (INHERITS_FROM)
        #   2. 连接所有 LibClang 能确定的函数调用 (USR Match)
        #   3. 连接宏别名调用 (Alias Match) - [新特性]
        # 替代了: GlobalRefPass
        pm.register(LinkerPass, dependencies=[])

        # 1.2 模糊调用图构建 (High Recall Fallback)
        # 职责:
        #   1. 补充 LinkerPass 漏掉的调用 (例如 C 语言的 static 函数，或解析不完整的函数)
        #   2. 使用 DiskMap 处理大规模数据
        # 依赖: 它可以和 LinkerPass 并行 (dependencies=[])，也可以串行。
        # 建议: 并行运行以加快速度。数据库层通常会自动处理重复边(deduplication)。
        pm.register(CallGraphPass, dependencies=[])

        # 1.3 指针分析 (Global Points To)
        # 依赖: 需要图的骨架 (Call 边和 Ref 边) 全部就绪
        # [Update] 必须依赖 LinkerPass (提供变量 Ref) 和 CallGraphPass (提供完整 Call Graph)
        pm.register(GlobalPointsToPass, dependencies=[LinkerPass, CallGraphPass])

        # =========================================================
        # Group 2: AI 增强 (AI Enhancements)
        # =========================================================
        ai_deps = []  # 用于收集 AI 产生的增强，供 PDG 使用

        if cfg.ai.enable_llm:
            # 2.1 语义向量化 (依赖结构稳定)
            # 必须先有 Method 节点
            if cfg.ai.enable_embedding:
                pm.register(
                    SemanticEmbeddingPass,
                    dependencies=[CallGraphPass],  # 确保方法节点已就绪
                    targets=[NodeLabel.METHOD, NodeLabel.TYPE_DECL],
                    name="SemanticEmbedding_Method_Typedecl"
                )

            # 2.2 动态调用解析 (Repair)
            # 依赖: CallGraph (基础边), Embedding (相似度搜索)
            if cfg.ai.enable_smart_resolver:
                resolver_deps = [CallGraphPass]
                if cfg.ai.enable_embedding:
                    resolver_deps.append("SemanticEmbedding_Method_Typedecl")

                pm.register(
                    SmartGraphResolver,
                    dependencies=resolver_deps,
                    confidence_threshold=cfg.ai.confidence_threshold
                )
                ai_deps.append(SmartGraphResolver)

            # 2.3 外部库摘要 (Summary)
            # 依赖: CallGraph (确定哪些是外部调用)
            if cfg.ai.enable_smart_summary:
                pm.register(SmartSummaryPass, dependencies=[CallGraphPass])
                ai_deps.append(SmartSummaryPass)

        # =========================================================
        # Group 3: 深度依赖分析 (Deep Analysis - PDG)
        # =========================================================
        # PDG 是核心汇聚点，它需要所有的 "边" 都已经建立完毕 (Call, Ref, PointsTo, DynamicCalls)
        pdg_deps = [
            GlobalPointsToPass,  # PointsTo 隐含了 Linker/CallGraph 依赖
            LinkerPass,  # 显式声明依赖 (为了 Ref 边)
            CallGraphPass  # 显式声明依赖 (为了 Call 边)
        ]
        # 加入 AI 修复产生的依赖 (如果启用了，PDG 就能利用 AI 修复的边)
        pdg_deps.extend(ai_deps)

        pm.register(PDGPass, dependencies=pdg_deps)

        # =========================================================
        # Group 4: 安全业务 (Security & Aggregation)
        # =========================================================

        # 4.1 安全标签 (依赖 PDG 切片能力)
        if cfg.ai.enable_llm and cfg.ai.enable_security_tagging:
            pm.register(SecurityTaggingPass, dependencies=[PDGPass])

        # 4.2 Entry Point Detection (依赖 CallGraph 进行 L2 tracing)
        # Entry Point 检测需要 Call Graph 来追踪 wrapper 函数
        pm.register(EntryPointPass, dependencies=[CallGraphPass])

        # 4.3 Source Detection (依赖 CallGraph，与 EntryPointPass 相同依赖模式)
        # Taint source call sites grouped by enclosing METHOD (Smart Wrapper pattern)
        pm.register(SourcePass, dependencies=[CallGraphPass])

        # 4.4 Sink Detection (依赖 CallGraph，与 SourcePass 相同依赖模式)
        from codedmap.analysis.passes.batch.sink_pass import SinkPass
        pm.register(SinkPass, dependencies=[CallGraphPass])

        # 4.5 Guard Detection (依赖 CallGraph，与 SourcePass/SinkPass 相同依赖模式)
        from codedmap.analysis.passes.batch.guard_pass import GuardPass
        pm.register(GuardPass, dependencies=[CallGraphPass])

        # 4.6 Sanitizer Detection (依赖 CallGraph，与 SourcePass/SinkPass 相同依赖模式)
        from codedmap.analysis.passes.batch.sanitizer_pass import SanitizerPass
        pm.register(SanitizerPass, dependencies=[CallGraphPass])

        # 4.3 高层摘要 (File Embedding)
        if cfg.ai.enable_llm and cfg.ai.enable_embedding:
            # File Embedding 依赖 Method Embedding 完成
            pm.register(
                SemanticEmbeddingPass,
                dependencies=["SemanticEmbedding_Method_Typedecl"],
                targets=[NodeLabel.FILE],
                name="SemanticEmbedding_File"
            )

    def shutdown(self):
        # 增加判空保护
        if self.store:
            self.store.close()
        # Runner 如果有 close 方法也应该调用
        # if self.runner and hasattr(self.runner, 'close'): self.runner.close()