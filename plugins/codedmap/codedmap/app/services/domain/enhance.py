"""Enhance service: run analysis passes on an existing CPG database."""

from __future__ import annotations

from typing import Optional

from codedmap.app.build import CPGBuildEngine

# Order is display-oriented; actual execution order is DAG-driven.
AVAILABLE_PASSES = ["linker", "callgraph", "pointsto", "pdg", "globalref"]
DEFAULT_PASSES = ["linker", "callgraph", "pointsto", "pdg"]


def run_enhance(
    db: str,
    backend: str = "sqlite",
    passes: Optional[list[str]] = None,
    force: bool = False,
    workers: Optional[int] = None,
    config_path: Optional[str] = None,
    project_root: str = ".",
) -> dict:
    if not db:
        raise ValueError("Error: --db or $CPG_DB is required.")

    pass_names = list(passes or DEFAULT_PASSES)
    is_ai = "ai" in pass_names
    analysis_passes = [p for p in pass_names if p != "ai"]

    engine = CPGBuildEngine(
        project_root=project_root,
        db=db,
        backend=backend,
        config_path=config_path,
        workers=workers,
    )

    if is_ai:
        engine.config.ai.enable_llm = True
        engine.ai_enhance(force_rerun=force)

    if analysis_passes:
        engine.enhance(pass_names=analysis_passes, force_rerun=force)

    return {"status": "completed", "passes_run": pass_names, "db": db}

