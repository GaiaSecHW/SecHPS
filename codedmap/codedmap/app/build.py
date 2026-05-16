# codedmap/app/build.py
"""
Application-level CPG build API.

Wraps PipelineOrchestrator with a simplified interface for CLI and scripts.
"""
from pathlib import Path
from typing import Optional, List

from codedmap.core.configs.cpg_config import CPGConfig
from codedmap.core.configs.storage import StorageConfig
from codedmap.core.configs.parser import ParserConfig


class CPGBuildEngine:
    """
    Simplified build entry point.

    Workspace priority: db > workspace > default (<project_root>/workspace)

    Usage:
        engine = CPGBuildEngine(
            project_root="/path/to/code",
            db="/path/to/graph.db",
        )
        engine.build()  # Full pipeline
        engine.build(skip_ingestion=True)  # Re-run analysis only
        engine.ai_enhance()  # AI passes only
    """

    def __init__(
        self,
        project_root: str,
        db: str = None,
        workspace: str = None,
        backend: str = "sqlite",
        config: CPGConfig = None,
        config_path: str = None,
        languages: List[str] = None,
        workers: int = None,
    ):
        if config:
            self.config = config
        elif config_path:
            self.config = CPGConfig.load_from_yaml(
                config_path, project_root_override=project_root
            )
        else:
            overrides = self._build_overrides(
                project_root=project_root,
                db=db,
                workspace=workspace,
                backend=backend,
                languages=languages,
                workers=workers,
            )
            self.config = CPGConfig.for_build(project_root, **overrides)

        self._orchestrator = None

    def _build_overrides(
        self,
        project_root: str,
        db: str = None,
        workspace: str = None,
        backend: str = "sqlite",
        languages: List[str] = None,
        workers: int = None,
    ) -> dict:
        """
        Build config overrides with unified workspace logic.

        Priority: db > workspace > default
        """
        overrides = {}
        project_root_path = Path(project_root).resolve()

        # Step 1: Determine workspace
        if db:
            db_path = Path(db)
            if db_path.is_absolute():
                resolved_workspace = db_path.parent
            else:
                resolved_workspace = (project_root_path / db_path).parent
        elif workspace:
            ws_path = Path(workspace)
            if ws_path.is_absolute():
                resolved_workspace = ws_path
            else:
                resolved_workspace = project_root_path / ws_path
        else:
            resolved_workspace = project_root_path / "workspace"

        overrides["workspace"] = resolved_workspace

        # Step 2: Determine db path for storage config
        if db:
            db_uri = db
        else:
            db_uri = str(resolved_workspace / "graph.db")

        overrides["storage"] = StorageConfig(backend=backend, uri=db_uri)

        # Step 3: Parser config
        if languages or workers is not None:
            parser_kwargs = {}
            if languages:
                parser_kwargs["languages"] = languages
            if workers is not None:
                parser_kwargs["n_workers"] = workers
            overrides["parser"] = ParserConfig(**parser_kwargs)

        return overrides

    @property
    def orchestrator(self):
        if self._orchestrator is None:
            from codedmap.pipeline.orchestrator import PipelineOrchestrator
            self._orchestrator = PipelineOrchestrator(config=self.config)
        return self._orchestrator

    def build(self, **kwargs):
        """Run full pipeline (ingestion + analysis + export)."""
        try:
            self.orchestrator.run_full_pipeline(**kwargs)
        finally:
            self.orchestrator.shutdown()

    def enhance(self, pass_names: List[str] = None, force_rerun: bool = False):
        """
        Run specific analysis passes on an existing graph (no ingestion).

        This is designed for enhancing Joern-imported databases with passes
        that Joern doesn't provide (e.g., points-to analysis for indirect calls).

        Args:
            pass_names: List of pass names to run. If None, runs the default
                        set: ["linker", "callgraph", "pointsto", "pdg"].
            force_rerun: If True, re-run passes even if already completed.
        """
        from codedmap.analysis.passes.batch.linker import LinkerPass
        from codedmap.analysis.passes.batch.call_graph import CallGraphPass
        from codedmap.analysis.passes.batch.global_points_to import GlobalPointsToPass
        from codedmap.analysis.passes.batch.pdg import PDGPass
        from codedmap.analysis.passes.batch.global_ref import GlobalRefPass

        pass_map = {
            "linker": LinkerPass,
            "callgraph": CallGraphPass,
            "pointsto": GlobalPointsToPass,
            "pdg": PDGPass,
            "globalref": GlobalRefPass,
        }

        if pass_names is None:
            pass_names = ["linker", "callgraph", "pointsto", "pdg"]

        target_classes = []
        for name in pass_names:
            cls = pass_map.get(name)
            if cls is None:
                raise ValueError(f"Unknown pass: {name!r}. Available: {list(pass_map.keys())}")
            target_classes.append(cls)

        try:
            self.orchestrator.run_enhance(target_classes, force_rerun=force_rerun)
        finally:
            self.orchestrator.shutdown()

    def ai_enhance(self, force_rerun: bool = True):
        """Run AI enhancement passes only (requires existing graph)."""
        try:
            self.orchestrator.run_ai_enhancement(force_rerun=force_rerun)
        finally:
            self.orchestrator.shutdown()
