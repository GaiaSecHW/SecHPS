from __future__ import annotations

import io
import tarfile
import zipfile
from pathlib import Path

import pytest

from codedmap.core.schema.build_upload import ArchiveFormat


def _write_zip(path: Path, members: list[tuple[str, bytes]]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, content in members:
            archive.writestr(name, content)


def _write_tar(path: Path, members: list[tuple[str, bytes]]) -> None:
    with tarfile.open(path, "w") as archive:
        for name, content in members:
            info = tarfile.TarInfo(name=name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))


def test_detect_archive_format_allowlist():
    from codedmap.app.archive_uploads import detect_archive_format

    assert detect_archive_format("source.zip") == ArchiveFormat.ZIP
    assert detect_archive_format("source.tar") == ArchiveFormat.TAR
    assert detect_archive_format("source.tar.gz") == ArchiveFormat.TAR_GZ
    assert detect_archive_format("source.tgz") == ArchiveFormat.TAR_GZ
    assert detect_archive_format("source.tar.bz2") == ArchiveFormat.TAR_BZ2
    assert detect_archive_format("source.tbz2") == ArchiveFormat.TAR_BZ2
    assert detect_archive_format("source.tar.xz") == ArchiveFormat.TAR_XZ
    assert detect_archive_format("source.txz") == ArchiveFormat.TAR_XZ

    with pytest.raises(ValueError):
        detect_archive_format("source.rar")


@pytest.mark.parametrize(
    ("archive_name", "archive_format", "builder", "member_name"),
    [
        ("escape.zip", ArchiveFormat.ZIP, _write_zip, "../escape.txt"),
        ("absolute.zip", ArchiveFormat.ZIP, _write_zip, "/escape.txt"),
        ("escape.tar", ArchiveFormat.TAR, _write_tar, "../escape.txt"),
        ("absolute.tar", ArchiveFormat.TAR, _write_tar, "/escape.txt"),
    ],
)
def test_safe_extract_archive_rejects_path_traversal(
    tmp_path: Path,
    archive_name: str,
    archive_format: ArchiveFormat,
    builder,
    member_name: str,
):
    from codedmap.app.archive_uploads import safe_extract_archive

    archive_path = tmp_path / archive_name
    extracted_root = tmp_path / "extracted"
    builder(archive_path, [(member_name, b"blocked")])

    with pytest.raises(ValueError):
        safe_extract_archive(archive_path, extracted_root, archive_format)

    assert not extracted_root.exists() or not any(extracted_root.rglob("*"))


def test_safe_extract_archive_rejects_without_partial_output(tmp_path: Path):
    from codedmap.app.archive_uploads import safe_extract_archive

    archive_path = tmp_path / "mixed.zip"
    extracted_root = tmp_path / "extracted"
    _write_zip(
        archive_path,
        [
            ("safe/file.txt", b"ok"),
            ("../escape.txt", b"nope"),
        ],
    )

    with pytest.raises(ValueError):
        safe_extract_archive(archive_path, extracted_root, ArchiveFormat.ZIP)

    assert not extracted_root.exists() or not any(extracted_root.rglob("*"))


def test_resolve_extracted_project_root_normalizes_single_folder_archives(tmp_path: Path):
    from codedmap.app.archive_uploads import resolve_extracted_project_root

    extracted_root = tmp_path / "extracted"
    project_root = extracted_root / "project"
    project_root.mkdir(parents=True)

    assert resolve_extracted_project_root(extracted_root) == project_root

    (extracted_root / "README.md").write_text("hello", encoding="utf-8")

    assert resolve_extracted_project_root(extracted_root) == extracted_root
