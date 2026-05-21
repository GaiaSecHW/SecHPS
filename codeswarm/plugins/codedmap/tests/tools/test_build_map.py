from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_module():
    root = Path(__file__).resolve().parents[2]
    mod_path = root / "tools" / "build_map.py"
    spec = importlib.util.spec_from_file_location("build_map", mod_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_infer_project_root_and_name_src_dir():
    mod = _load_module()
    target = Path("/tmp/example/src")
    project_root, project_name = mod.infer_project_root_and_name(target, None)
    assert project_root == Path("/tmp/example").resolve()
    assert project_name == "example"


def test_infer_project_root_and_name_custom_name():
    mod = _load_module()
    target = Path("/tmp/example/src")
    project_root, project_name = mod.infer_project_root_and_name(target, "my_proj")
    assert project_root == Path("/tmp/example").resolve()
    assert project_name == "my_proj"


def test_resolve_workspace_default_and_relative():
    mod = _load_module()
    root = Path("/tmp/demo")
    assert mod.resolve_workspace(root, None) == Path("/tmp/demo/workspace").resolve()
    assert mod.resolve_workspace(root, "my_ws") == Path("/tmp/demo/my_ws").resolve()


def test_build_cdm_command_contains_joern_dir_and_flags():
    mod = _load_module()
    input_spec = mod.JoernCSVInputSpec(
        export_dir=Path("/repo/p/workspace/joern/p_csv"),
        id_strategy="hybrid",
        skip_unknown=True,
    )
    cmd = mod.build_cdm_command(
        project_root=Path("/repo/p"),
        workspace=Path("/repo/p/workspace"),
        input_spec=input_spec,
        backend="sqlite",
        db="/repo/p/workspace/graph.db",
        skip_analysis=True,
        skip_export=False,
    )
    assert cmd[:2] == ["build", "/repo/p"]
    assert "--joern-dir" in cmd
    assert "/repo/p/workspace/joern/p_csv" in cmd
    assert "--joern-id-strategy" in cmd
    assert "hybrid" in cmd
    assert "--joern-skip-unknown" in cmd
    assert "--skip-analysis" in cmd
    assert "--output" in cmd
    assert "text" in cmd


def test_prepare_input_returns_joern_spec(tmp_path):
    mod = _load_module()
    target = tmp_path / "proj"
    target.mkdir()
    project_root, project_name = mod.infer_project_root_and_name(target, None)
    workspace = mod.resolve_workspace(project_root, None)
    paths = mod.build_paths(target_dir=target, project_name=project_name, workspace=workspace)

    args = mod.argparse.Namespace(
        target_dir=str(target),
        project_name=None,
        mode="auto",
        docker=False,
        artifact_dir=None,
        docker_image=mod.DEFAULT_DOCKER_IMAGE,
        joern_home=None,
        workspace=None,
        db=None,
        backend="sqlite",
        joern_id_strategy="hybrid",
        joern_skip_unknown=False,
        fallback_uncompiled=False,
        skip_analysis=False,
        skip_export=False,
        force=False,
    )
    ctx = mod.BuildContext(args=args, paths=paths)

    expected = mod.JoernCSVInputSpec(
        export_dir=paths.joern_csv_dir,
        id_strategy="hybrid",
        skip_unknown=False,
    )

    def _fake_prepare(_ctx):
        return expected

    original = mod.prepare_joern_input
    mod.prepare_joern_input = _fake_prepare
    try:
        actual = mod.prepare_input(ctx)
    finally:
        mod.prepare_joern_input = original

    assert actual == expected


def test_prepare_input_returns_artifact_spec(tmp_path):
    mod = _load_module()
    target = tmp_path / "proj"
    target.mkdir()
    artifact_dir = tmp_path / "artifacts"
    artifact_dir.mkdir()
    (artifact_dir / "compile_commands.json").write_text("[]", encoding="utf-8")
    (artifact_dir / "ast_artifacts").mkdir()

    project_root, project_name = mod.infer_project_root_and_name(target, None)
    workspace = mod.resolve_workspace(project_root, None)
    paths = mod.build_paths(target_dir=target, project_name=project_name, workspace=workspace)
    args = mod.argparse.Namespace(
        target_dir=str(target),
        project_name=None,
        mode="auto",
        artifact_dir=str(artifact_dir),
        docker=False,
        docker_image=mod.DEFAULT_DOCKER_IMAGE,
        joern_home=None,
        workspace=None,
        db=None,
        backend="sqlite",
        joern_id_strategy="hybrid",
        joern_skip_unknown=False,
        fallback_uncompiled=True,
        skip_analysis=False,
        skip_export=False,
        force=False,
    )
    ctx = mod.BuildContext(args=args, paths=paths)

    actual = mod.prepare_input(ctx)

    assert isinstance(actual, mod.ArtifactImportInputSpec)
    assert actual.artifact_dir == artifact_dir.resolve()
    assert actual.fallback_uncompiled is True


def test_resolve_local_joern_bins_prefers_explicit_home(tmp_path, monkeypatch):
    mod = _load_module()
    home = tmp_path / "joern"
    home.mkdir()
    (home / "joern-parse").write_text("", encoding="utf-8")
    (home / "joern-export").write_text("", encoding="utf-8")

    monkeypatch.delenv("JOERN_HOME", raising=False)
    monkeypatch.setattr(mod.shutil, "which", lambda _name: None)

    parse_bin, export_bin, source = mod.resolve_local_joern_bins(str(home))
    assert parse_bin == str(home / "joern-parse")
    assert export_bin == str(home / "joern-export")
    assert source.startswith("--joern-home=")


def test_resolve_local_joern_bins_falls_back_to_path(monkeypatch):
    mod = _load_module()
    monkeypatch.delenv("JOERN_HOME", raising=False)
    monkeypatch.setattr(
        mod.shutil,
        "which",
        lambda name: f"/usr/local/bin/{name}" if name in ("joern-parse", "joern-export") else None,
    )
    parse_bin, export_bin, source = mod.resolve_local_joern_bins(None)
    assert parse_bin == "/usr/local/bin/joern-parse"
    assert export_bin == "/usr/local/bin/joern-export"
    assert source == "PATH"


def test_run_cdm_build_prefers_cdm(monkeypatch):
    mod = _load_module()
    seen: list[list[str]] = []

    def _fake_run(cmd, cwd=None):
        seen.append(cmd)

    monkeypatch.setattr(mod, "_run_cmd", _fake_run)
    mod.run_cdm_build(["build", "/x"], repo_root=Path("/repo"), which_func=lambda name: "/usr/bin/cdm" if name == "cdm" else None)
    assert seen == [["cdm", "build", "/x"]]


def test_run_cdm_build_fallback_python_module(monkeypatch):
    mod = _load_module()
    seen: list[list[str]] = []

    def _fake_run(cmd, cwd=None):
        seen.append(cmd)

    monkeypatch.setattr(mod, "_run_cmd", _fake_run)
    mod.run_cdm_build(["build", "/x"], repo_root=Path("/repo"), which_func=lambda _name: None)
    assert seen == [["python3", "-m", "codedmap.cli", "build", "/x"]]


def test_clear_workspace_removes_all_children(tmp_path):
    mod = _load_module()
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "a.txt").write_text("x", encoding="utf-8")
    sub = workspace / "sub"
    sub.mkdir()
    (sub / "b.txt").write_text("y", encoding="utf-8")

    mod.clear_workspace(workspace)

    assert workspace.exists()
    assert list(workspace.iterdir()) == []


def test_run_stage_records_timing():
    mod = _load_module()
    paths = mod.BuildPaths(
        target_dir=Path("/tmp/target"),
        project_root=Path("/tmp/target"),
        project_name="target",
        workspace=Path("/tmp/target/workspace"),
        repo_root=Path("/tmp/repo"),
        joern_workspace=Path("/tmp/target/workspace/joern"),
        joern_cpg_file=Path("/tmp/target/workspace/joern/target_cpg.bin"),
        joern_csv_dir=Path("/tmp/target/workspace/joern/target_csv"),
        default_db_path=Path("/tmp/target/workspace/graph.db"),
    )
    args = mod.argparse.Namespace()
    ctx = mod.BuildContext(args=args, paths=paths)

    mod.run_stage(ctx, "example", lambda: None)

    assert len(ctx.timings) == 1
    assert ctx.timings[0].name == "example"
    assert ctx.timings[0].seconds >= 0


def test_artifact_input_extends_cdm_args():
    mod = _load_module()
    cmd = ["build", "/repo/p"]
    spec = mod.ArtifactImportInputSpec(
        artifact_dir=Path("/repo/artifacts"),
        fallback_uncompiled=True,
    )

    spec.extend_cdm_args(cmd)

    assert "--artifact-dir" in cmd
    assert "/repo/artifacts" in cmd
    assert "--fallback-uncompiled" in cmd


def test_resolve_mode_artifact_requires_artifact_dir():
    mod = _load_module()
    args = mod.argparse.Namespace(mode="artifact", artifact_dir=None)

    try:
        mod.resolve_mode(args)
    except RuntimeError as exc:
        assert "--mode artifact requires --artifact-dir" in str(exc)
    else:
        assert False, "expected RuntimeError"


def test_resolve_mode_joern_rejects_artifact_dir():
    mod = _load_module()
    args = mod.argparse.Namespace(mode="joern", artifact_dir="/tmp/a")

    try:
        mod.resolve_mode(args)
    except RuntimeError as exc:
        assert "--artifact-dir cannot be used with --mode joern" in str(exc)
    else:
        assert False, "expected RuntimeError"
