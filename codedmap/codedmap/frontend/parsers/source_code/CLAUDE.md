# cpg_schema/frontend/parsers/source_code — Tree-sitter Source Code Parsers

Pure tree-sitter → CPG parsers for C, C++, and Python source code.

## Module Map

```
source_code/
  base.py             # SourceCodeParser — tree-sitter base (reads file, parses AST)
  c_parser.py         # CParser(SourceCodeParser) — C language parser
  cpp_parser.py       # CppParser(CParser) — C++ language parser (extends C dispatch table)
  python_parser.py    # PythonCodeParser — Python language parser
```

## Inheritance Chain

```
AbstractParser (frontend/parsers/base.py)
  └── SourceCodeParser (base.py)        — tree-sitter setup, _perform_parse()
        └── CParser (c_parser.py)       — C grammar, dispatch table, AST→CPG handlers
              └── CppParser (cpp_parser.py) — C++ grammar, extended dispatch table
```

## Architecture

CParser and CppParser are **pure tree-sitter parsers**. They:
1. Read source file → parse via tree-sitter → walk AST → emit CPG nodes/edges
2. Use a dispatch table (`_dispatch_table`) mapping tree-sitter node types to handler methods
3. Do **not** perform macro recovery, sanitization, or AI healing

### Primary C/C++ Parsing Path

The pipeline uses a hybrid approach (see `pipeline/frontend.py`):
1. **ClangJSON (primary):** If Clang AST artifacts exist, use `ClangJSONParser` for precise IR-based parsing
2. **Tree-sitter (fallback):** If no artifacts, use `CParser`/`CppParser` for heuristic tree-sitter parsing
3. **Comment extraction:** Even in ClangJSON mode, `CParser.parse_comments_only()` extracts comments via tree-sitter

### History

The macro recovery pipeline (SmartSourceCodeParser, SourceSanitizer, recovery/, SyntaxHealer, sanitizer_profiles) was removed in Phase 20.7. CParser/CppParser were re-parented from SmartSourceCodeParser directly to SourceCodeParser.

## CParser Key Features

- **Dispatch table:** Maps ~40 tree-sitter C node types to handler methods
- **Parse strategies:** FULL (complete AST) vs SKELETON (declarations only, no function bodies)
- **Comment extraction:** `parse_comments_only()` for hybrid ClangJSON+tree-sitter mode
- **Known functions tracking:** `known_functions: set[str]` for call resolution hints

## CppParser Extensions

CppParser extends CParser's dispatch table with C++-specific handlers:
- Namespaces, classes/structs/unions with inheritance
- Templates, lambdas with capture bindings
- Access specifiers (public/private/protected)
- Exception handling (try/catch/throw)
- C++ casts (static_cast, dynamic_cast, etc.)
- Memory management (new/delete)
- Range-based for loops
- Using declarations and type aliases

## Agent Rules

1. **CParser/CppParser constructors take only `builder` and `project_root`** — no sanitizer, no AI recovery parameters
2. **SourceCodeParser.`_perform_parse()` is the parse entry point** — direct tree-sitter parse, no preprocessing
3. **Dispatch table pattern:** To add a new node type handler, add an entry to `_dispatch_table` in `__init__` and implement the handler method
4. **Don't add macro recovery back** — ClangJSON is the authoritative C/C++ parser; tree-sitter is fallback only
