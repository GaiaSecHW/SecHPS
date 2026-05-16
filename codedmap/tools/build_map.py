#!/usr/bin/env python3
"""Unified CodeDMap build helper.

Current supported build source:
  - Joern CSV export generated from source tree (local Joern or Docker Joern)

The internal structure is intentionally split into:
  - path/context resolution
  - source preparation
  - CodeDMap build execution

This keeps the script extensible for future modes such as:
  - direct source build
  - AST-artifact-assisted build via tools/ast_exporter
"""

from __future__ import annotations

import argparse
import os
import shlex
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


SPECIAL_SOURCE_DIRS = {"src", "lib", "include", "source"}
DEFAULT_DOCKER_IMAGE = "ghcr.io/joernio/joern-slim:nightly"


@dataclass
class StageTiming:
    name: str
    seconds: float


@dataclass
class BuildPaths:
    target_dir: Path
    project_root: Path
    project_name: str
    workspace: Path
    repo_root: Path
    joern_workspace: Path
    joern_cpg_file: Path
    joern_csv_dir: Path
    default_db_path: Path


@dataclass
class BuildContext:
    args: argparse.Namespace
    paths: BuildPaths
    timings: list[StageTiming] = field(default_factory=list)

    def record(self, name: str, seconds: float) -> None:
        self.timings.append(StageTiming(name=name, seconds=seconds))


@dataclass
class BuildInputSpec:
    def extend_cdm_args(self, cmd: list[str]) -> None:
        raise NotImplementedError


@dataclass
class JoernCSVInputSpec(BuildInputSpec):
    export_dir: Path
    id_strategy: str
    skip_unknown: bool

    def extend_cdm_args(self, cmd: list[str]) -> None:
        cmd.extend(["--joern-dir", str(self.export_dir)])
        cmd.extend(["--joern-id-strategy", self.id_strategy])
        if self.skip_unknown:
            cmd.append("--joern-skip-unknown")


@dataclass
class ArtifactImportInputSpec(BuildInputSpec):
    artifact_dir: Path
    fallback_uncompiled: bool

    def extend_cdm_args(self, cmd: list[str]) -> None:
        cmd.extend(["--artifact-dir", str(self.artifact_dir)])
        if self.fallback_uncompiled:
            cmd.append("--fallback-uncompiled")


def _run_cmd(cmd: list[str], cwd: Path | None = None) -> None:
    cwd_text = f" (cwd={cwd})" if cwd else ""
    print(f"$ {' '.join(shlex.quote(part) for part in cmd)}{cwd_text}", flush=True)
    subprocess.run(cmd, check=True, cwd=str(cwd) if cwd else None)


def format_duration(seconds: float) -> str:
    if seconds < 1:
        return f"{seconds:.2f}s"
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = int(seconds // 60)
    remain = seconds - (minutes * 60)
    return f"{minutes}m{remain:.1f}s"


def run_stage(ctx: BuildContext, name: str, action: Callable[[], None]) -> None:
    print(f"[*] Stage start: {name}", flush=True)
    started_at = time.monotonic()
    action()
    elapsed = time.monotonic() - started_at
    ctx.record(name, elapsed)
    print(f"[*] Stage done : {name} ({format_duration(elapsed)})", flush=True)


def print_timing_summary(ctx: BuildContext) -> None:
    if not ctx.timings:
        return
    total = sum(item.seconds for item in ctx.timings)
    print("[*] Timing summary:", flush=True)
    for item in ctx.timings:
        print(f"    - {item.name}: {format_duration(item.seconds)}", flush=True)
    print(f"    - total: {format_duration(total)}", flush=True)


def clear_workspace(workspace: Path) -> None:
    if not workspace.exists():
        return
    for item in workspace.iterdir():
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()


def infer_project_root_and_name(target_dir: Path, custom_name: str | None) -> tuple[Path, str]:
    target = target_dir.resolve()
    if target.name in SPECIAL_SOURCE_DIRS and target.parent.name:
        project_root = target.parent
        inferred_name = target.parent.name
    else:
        project_root = target
        inferred_name = target.name
    return project_root, custom_name or inferred_name


def resolve_workspace(project_root: Path, workspace_arg: str | None) -> Path:
    if not workspace_arg:
        return (project_root / "workspace").resolve()
    workspace = Path(workspace_arg).expanduser()
    if workspace.is_absolute():
        return workspace.resolve()
    return (project_root / workspace).resolve()


def build_paths(target_dir: Path, project_name: str, workspace: Path) -> BuildPaths:
    repo_root = Path(__file__).resolve().parent.parent
    joern_workspace = workspace / "joern"
    project_root, _ = infer_project_root_and_name(target_dir, project_name)
    return BuildPaths(
        target_dir=target_dir.resolve(),
        project_root=project_root,
        project_name=project_name,
        workspace=workspace.resolve(),
        repo_root=repo_root,
        joern_workspace=joern_workspace.resolve(),
        joern_cpg_file=(joern_workspace / f"{project_name}_cpg.bin").resolve(),
        joern_csv_dir=(joern_workspace / f"{project_name}_csv").resolve(),
        default_db_path=(workspace / "graph.db").resolve(),
    )


def resolve_local_joern_bins(joern_home_arg: str | None) -> tuple[str, str, str]:
    def _from_home(home: Path) -> tuple[str, str] | None:
        parse_bin = home / "joern-parse"
        export_bin = home / "joern-export"
        if parse_bin.exists() and export_bin.exists():
            return str(parse_bin), str(export_bin)
        return None

    if joern_home_arg:
        home = Path(joern_home_arg).expanduser().resolve()
        bins = _from_home(home)
        if not bins:
            raise RuntimeError(f"Invalid --joern-home: {home} (joern-parse/joern-export not found)")
        return bins[0], bins[1], f"--joern-home={home}"

    env_home = os.environ.get("JOERN_HOME")
    if env_home:
        home = Path(env_home).expanduser().resolve()
        bins = _from_home(home)
        if bins:
            return bins[0], bins[1], f"JOERN_HOME={home}"

    parse_path = shutil.which("joern-parse")
    export_path = shutil.which("joern-export")
    if parse_path and export_path:
        return parse_path, export_path, "PATH"

    raise RuntimeError(
        "Could not locate Joern binaries. Set --joern-home, or JOERN_HOME, "
        "or ensure joern-parse and joern-export are in PATH."
    )


def prepare_workspace_for_joern(paths: BuildPaths) -> None:
    paths.joern_workspace.mkdir(parents=True, exist_ok=True)
    if paths.joern_cpg_file.exists():
        paths.joern_cpg_file.unlink()
    if paths.joern_csv_dir.exists():
        shutil.rmtree(paths.joern_csv_dir)


def run_local_joern_export(paths: BuildPaths, joern_home_arg: str | None) -> None:
    parse_bin, export_bin, source = resolve_local_joern_bins(joern_home_arg)
    print(f"[*] Joern mode: local ({source})", flush=True)
    print("[*] Joern step 1/2: generating CPG binary", flush=True)
    _run_cmd([parse_bin, str(paths.target_dir), "--output", str(paths.joern_cpg_file)])
    print("[*] Joern step 2/2: exporting neo4jcsv", flush=True)
    _run_cmd(
        [
            export_bin,
            str(paths.joern_cpg_file),
            "--repr",
            "all",
            "--format",
            "neo4jcsv",
            "--out",
            str(paths.joern_csv_dir),
        ]
    )


def run_docker_joern_export(paths: BuildPaths, image: str) -> None:
    print(f"[*] Joern mode: docker ({image})", flush=True)
    uid = os.getuid()
    gid = os.getgid()
    cpg_name = shlex.quote(paths.joern_cpg_file.name)
    csv_name = shlex.quote(paths.joern_csv_dir.name)
    script = (
        "set -eu;"
        " echo '[Docker] 1/3 generating CPG binary';"
        f" joern-parse /target --output /workspace/{cpg_name};"
        " echo '[Docker] 2/3 exporting neo4jcsv';"
        f" joern-export /workspace/{cpg_name} --repr all --format neo4jcsv --out /workspace/{csv_name};"
        " echo '[Docker] 3/3 fixing workspace ownership';"
        f" chown -R {uid}:{gid} /workspace || true;"
        " echo '[Docker] done';"
    )
    _run_cmd(
        [
            "docker",
            "run",
            "--rm",
            "-t",
            "-v",
            "/tmp:/tmp",
            "-v",
            f"{paths.target_dir}:/target:ro",
            "-v",
            f"{paths.joern_workspace}:/workspace:rw",
            "-w",
            "/workspace",
            image,
            "sh",
            "-c",
            script,
        ]
    )


def prepare_joern_input(ctx: BuildContext) -> JoernCSVInputSpec:
    paths = ctx.paths
    prepare_workspace_for_joern(paths)
    if ctx.args.docker:
        run_docker_joern_export(paths, ctx.args.docker_image)
    else:
        run_local_joern_export(paths, ctx.args.joern_home)
    return JoernCSVInputSpec(
        export_dir=paths.joern_csv_dir,
        id_strategy=ctx.args.joern_id_strategy,
        skip_unknown=ctx.args.joern_skip_unknown,
    )


def prepare_artifact_input(ctx: BuildContext) -> ArtifactImportInputSpec:
    artifact_dir = Path(ctx.args.artifact_dir).expanduser().resolve()
    if not artifact_dir.is_dir():
        raise RuntimeError(f"artifact directory not found: {artifact_dir}")
    compile_db = artifact_dir / "compile_commands.json"
    artifact_root = artifact_dir / "ast_artifacts"
    if not compile_db.exists():
        raise RuntimeError(f"compile_commands.json not found in artifact directory: {artifact_dir}")
    if not artifact_root.is_dir():
        raise RuntimeError(f"ast_artifacts directory not found in artifact directory: {artifact_dir}")
    return ArtifactImportInputSpec(
        artifact_dir=artifact_dir,
        fallback_uncompiled=ctx.args.fallback_uncompiled,
    )


def build_cdm_command(
    project_root: Path,
    workspace: Path,
    input_spec: BuildInputSpec,
    backend: str,
    db: str | None,
    skip_analysis: bool,
    skip_export: bool,
) -> list[str]:
    cmd = [
        "build",
        str(project_root),
        "--workspace",
        str(workspace),
        "--backend",
        backend,
        "--output",
        "text",
    ]
    if db:
        cmd.extend(["--db", db])
    if skip_analysis:
        cmd.append("--skip-analysis")
    if skip_export:
        cmd.append("--skip-export")
    input_spec.extend_cdm_args(cmd)
    return cmd


def run_cdm_build(
    cdm_args: list[str],
    repo_root: Path,
    which_func: Callable[[str], str | None] = shutil.which,
) -> None:
    print("[*] CodeDMap step: importing prepared input and building database", flush=True)
    cdm_bin = which_func("cdm")
    if cdm_bin:
        try:
            _run_cmd(["cdm", *cdm_args], cwd=repo_root)
            return
        except FileNotFoundError:
            pass
    _run_cmd(["python3", "-m", "codedmap.cli", *cdm_args], cwd=repo_root)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build CodeDMap DB from Joern export in one command.")
    parser.add_argument("target_dir", help="Target source directory")
    parser.add_argument("-n", "--name", dest="project_name", default=None, help="Override project name")
    parser.add_argument(
        "--mode",
        choices=["auto", "joern", "artifact"],
        default="auto",
        help="Build input mode (default: auto)",
    )
    parser.add_argument(
        "--artifact-dir",
        default=None,
        help="Path containing compile_commands.json and ast_artifacts; skips Joern preparation",
    )
    parser.add_argument("--docker", action="store_true", help="Use Joern inside Docker container")
    parser.add_argument("--docker-image", default=DEFAULT_DOCKER_IMAGE, help="Joern Docker image")
    parser.add_argument("--joern-home", default=None, help="Local Joern install dir (contains joern-parse/export)")
    parser.add_argument("--workspace", default=None, help="CodeDMap workspace (default: <project_root>/workspace)")
    parser.add_argument("--db", default=None, help="Output DB path passed to CodeDMap build")
    parser.add_argument("--backend", choices=["sqlite", "neo4j"], default="sqlite", help="CodeDMap storage backend")
    parser.add_argument(
        "--joern-id-strategy",
        choices=["regenerate", "passthrough", "hybrid"],
        default="hybrid",
        help="ID strategy for CodeDMap Joern import",
    )
    parser.add_argument("--joern-skip-unknown", action="store_true", help="Skip unknown Joern node labels")
    parser.add_argument(
        "--fallback-uncompiled",
        action="store_true",
        help="When using --artifact-dir, fall back to source parsing for files missing from compile_commands.json",
    )
    parser.add_argument("--skip-analysis", action="store_true", help="Skip CodeDMap global analysis phase")
    parser.add_argument("--skip-export", action="store_true", help="Skip CodeDMap export phase")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Delete all existing content under workspace before rebuilding",
    )
    return parser.parse_args()


def build_context(args: argparse.Namespace) -> BuildContext:
    target_dir = Path(args.target_dir).expanduser().resolve()
    if not target_dir.is_dir():
        raise RuntimeError(f"target directory not found: {target_dir}")
    project_root, project_name = infer_project_root_and_name(target_dir, args.project_name)
    workspace = resolve_workspace(project_root, args.workspace)
    return BuildContext(
        args=args,
        paths=build_paths(target_dir=target_dir, project_name=project_name, workspace=workspace),
    )


def print_context(ctx: BuildContext) -> None:
    paths = ctx.paths
    print(f"[*] Target dir   : {paths.target_dir}", flush=True)
    print(f"[*] Project root : {paths.project_root}", flush=True)
    print(f"[*] Project name : {paths.project_name}", flush=True)
    print(f"[*] Workspace    : {paths.workspace}", flush=True)
    if resolve_mode(ctx.args) == "artifact":
        print(f"[*] Artifact dir : {Path(ctx.args.artifact_dir).expanduser().resolve()}", flush=True)
    else:
        print(f"[*] Joern out    : {paths.joern_workspace}", flush=True)


def resolve_mode(args: argparse.Namespace) -> str:
    if args.mode == "artifact":
        if not args.artifact_dir:
            raise RuntimeError("--mode artifact requires --artifact-dir")
        return "artifact"
    if args.mode == "joern":
        if args.artifact_dir:
            raise RuntimeError("--artifact-dir cannot be used with --mode joern")
        return "joern"
    return "artifact" if args.artifact_dir else "joern"


def prepare_input(ctx: BuildContext) -> BuildInputSpec:
    if resolve_mode(ctx.args) == "artifact":
        return prepare_artifact_input(ctx)
    return prepare_joern_input(ctx)


def main() -> int:
    started_at = time.monotonic()
    try:
        args = parse_args()
        ctx = build_context(args)
        print_context(ctx)

        if args.force:
            run_stage(
                ctx,
                "workspace cleanup",
                lambda: clear_workspace(ctx.paths.workspace),
            )

        build_input_box: dict[str, BuildInputSpec] = {}
        run_stage(ctx, "prepare build input", lambda: build_input_box.setdefault("value", prepare_input(ctx)))
        build_input = build_input_box["value"]

        cdm_args = build_cdm_command(
            project_root=ctx.paths.project_root,
            workspace=ctx.paths.workspace,
            input_spec=build_input,
            backend=args.backend,
            db=args.db,
            skip_analysis=args.skip_analysis,
            skip_export=args.skip_export,
        )
        run_stage(ctx, "codedmap build", lambda: run_cdm_build(cdm_args, repo_root=ctx.paths.repo_root))
    except subprocess.CalledProcessError as exc:
        print(f"[-] Command failed with exit code {exc.returncode}", file=sys.stderr)
        return exc.returncode or 1
    except RuntimeError as exc:
        print(f"[-] {exc}", file=sys.stderr)
        return 1

    total = time.monotonic() - started_at
    ctx.record("end-to-end", total)
    print_timing_summary(ctx)
    print("[+] Build completed.")
    if resolve_mode(args) == "artifact":
        print(f"    - Artifacts: {Path(args.artifact_dir).expanduser().resolve()}")
    else:
        print(f"    - Joern CSV: {ctx.paths.joern_csv_dir}")
    print(f"    - Database : {args.db or str(ctx.paths.default_db_path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
