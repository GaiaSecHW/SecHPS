from __future__ import annotations

import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from codedmap.core.schema.build_upload import ArchiveFormat


_ARCHIVE_SUFFIXES = {
    ".zip": ArchiveFormat.ZIP,
    ".tar": ArchiveFormat.TAR,
    ".tar.gz": ArchiveFormat.TAR_GZ,
    ".tgz": ArchiveFormat.TAR_GZ,
    ".tar.bz2": ArchiveFormat.TAR_BZ2,
    ".tbz2": ArchiveFormat.TAR_BZ2,
    ".tar.xz": ArchiveFormat.TAR_XZ,
    ".txz": ArchiveFormat.TAR_XZ,
}


def detect_archive_format(filename: str) -> ArchiveFormat:
    lower_name = filename.lower()
    for suffix, archive_format in _ARCHIVE_SUFFIXES.items():
        if lower_name.endswith(suffix):
            return archive_format
    raise ValueError(f"Unsupported archive format: {filename}")


def _validated_member_path(extracted_root: Path, member_name: str) -> Path:
    normalized = member_name.replace("\\", "/")
    member_path = PurePosixPath(normalized)
    if member_path.is_absolute() or any(part == ".." for part in member_path.parts):
        raise ValueError(f"Unsafe archive member: {member_name}")

    target_path = (extracted_root / Path(*member_path.parts)).resolve()
    root_path = extracted_root.resolve()
    if target_path != root_path and root_path not in target_path.parents:
        raise ValueError(f"Unsafe archive member: {member_name}")
    return target_path


def _open_tar_archive(archive_path: Path, archive_format: ArchiveFormat) -> tarfile.TarFile:
    mode = "r:*"
    if archive_format == ArchiveFormat.TAR:
        mode = "r:"
    return tarfile.open(archive_path, mode)


def safe_extract_archive(
    archive_path: Path, extracted_root: Path, archive_format: ArchiveFormat
) -> Path:
    extracted_root = extracted_root.resolve()
    extracted_root.parent.mkdir(parents=True, exist_ok=True)
    temp_root = Path(
        tempfile.mkdtemp(prefix=f"{extracted_root.name}-", dir=str(extracted_root.parent))
    )

    try:
        if archive_format == ArchiveFormat.ZIP:
            with zipfile.ZipFile(archive_path) as archive:
                members = archive.infolist()
                for member in members:
                    _validated_member_path(temp_root, member.filename)
                archive.extractall(temp_root)
        else:
            with _open_tar_archive(archive_path, archive_format) as archive:
                members = archive.getmembers()
                for member in members:
                    if member.issym() or member.islnk():
                        raise ValueError(f"Unsafe archive member: {member.name}")
                    _validated_member_path(temp_root, member.name)
                archive.extractall(temp_root, filter="data")

        if extracted_root.exists():
            shutil.rmtree(extracted_root)
        temp_root.replace(extracted_root)
        return extracted_root
    except Exception:
        if temp_root.exists():
            shutil.rmtree(temp_root)
        if extracted_root.exists():
            shutil.rmtree(extracted_root)
        raise


def resolve_extracted_project_root(extracted_root: Path) -> Path:
    top_level_entries = [entry for entry in extracted_root.iterdir()]
    if len(top_level_entries) == 1 and top_level_entries[0].is_dir():
        return top_level_entries[0]
    return extracted_root
