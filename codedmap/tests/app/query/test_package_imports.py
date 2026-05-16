import importlib
import sys


def _clear_query_modules() -> None:
    for name in list(sys.modules):
        if name == "codedmap.app.query" or name.startswith("codedmap.app.query."):
            sys.modules.pop(name, None)


def test_query_package_import_is_lazy():
    _clear_query_modules()

    importlib.import_module("codedmap.app.query")

    assert "codedmap.app.query.root" not in sys.modules


def test_query_package_exports_cpg_lazily():
    _clear_query_modules()

    from codedmap.app.query import CPG

    assert CPG.__module__ == "codedmap.app.query.root"
