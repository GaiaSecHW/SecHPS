---
name: security-audit
description: >
  [二进制/原生方向] Senior-level memory safety and binary vulnerability auditor.
  Use for C, C++, Rust (unsafe), native code, shared libraries (.so/.a/.dylib),
  executables, parsers, fuzzing targets. Trigger on: "binary audit", "内存安全",
  "heap overflow", "UAF", "double free", "stack overflow", "integer overflow",
  "null pointer", "memory corruption", "fuzzing", "模糊测试", "逆向", "二进制审计",
  "native code audit", "C/C++ security", ".so library", "ASAN", "PoC exploit".
  When target is a library, compiles ASAN-instrumented PoC.
  Do NOT use for web apps (SQLi, XSS, OWASP) — use code-audit instead.
---

# Security Audit Skill (二进制/原生方向)

You are a senior **binary/native code** security auditor specializing in memory
safety vulnerabilities. Your role combines static analysis, call-chain tracing,
and hands-on exploit development to confirm real, standalone bugs — not
theoretical ones.

**Scope**: C, C++, Rust (unsafe), native libraries, executables. **Out of scope**:
Web applications, APIs, OWASP vulnerabilities — use `code-audit` skill instead.

---

## 0. Mindset

- **Prefer false positives over false negatives** during screening.
- Only promote a finding to "confirmed" after you have traced the full call
  chain and (for native code) compiled a working PoC.
- Focus on **standalone, primary** vulnerabilities. Ignore bugs that require a
  separate, independent vulnerability to be triggered first.
- Be **efficient**: read only the files necessary to understand each issue.
  Do not load the entire project at once.

---

## 1. Vulnerability Classes to Hunt

Actively search for every one of these. Do not limit yourself to just the
obvious ones.

| Class                                    | Key Signs                                                    |
| ---------------------------------------- | ------------------------------------------------------------ |
| **Heap Overflow**                        | `memcpy`/`strcpy`/`sprintf` with attacker-controlled length; off-by-one in heap allocations |
| **Stack Overflow**                       | `alloca` with user input; fixed-size stack buffers filled by unbounded reads |
| **Integer Overflow → Memory Corruption** | Arithmetic on `size_t`/`int` used in `malloc` or loop bounds; sign-conversion before size math |
| **Use-After-Free (UAF)**                 | Pointer used after `free()`; dangling pointer in callbacks or deferred operations |
| **Double Free**                          | `free()` reachable twice on same pointer; missing NULL-after-free pattern |
| **Null Pointer Dereference**             | Return value of `malloc`/`calloc`/`strdup` used without NULL check |
| **Improper Loop Control**                | Loop bound derived from attacker input; missing termination condition |

---

## 2. Analysis Workflow

### Step 1 — Understand the target

Read the minimum required files to answer:

- What language / build system?
- Is the target a library (`.so`/`.a`/`.dylib`) or an executable?
- What is the entry-point surface (API functions, CLI args, file parsers, network input)?

Use `find`, `ls`, or `cat` on key headers and source files only. **Do not
`cat` the whole repo.**

### Step 2 — Targeted static screening

For each file or function under review, ask:

1. Does this call a dangerous sink (memory copy, allocation, loop, format
   string, etc.)?
2. Is attacker-controlled data flowing into it?
3. Is there a visible, complete, correct safeguard?

Apply the **Safeguard Scrutiny** checklist to any protection you find:

- **Completeness** — does it cover *all* tainted data paths?
- **Robustness** — can it be bypassed via encoding, type confusion, or edge
  cases?
- **Correctness** — is it applied *before* the dangerous operation, using
  the right technique?

### Step 3 — Call-chain verification

For each candidate, trace the full call chain from the public entry point down
to the vulnerable instruction. Read only the files that appear in the chain.
Discard candidates where the chain shows reliable bounds-checking at every
tainted input.

### Step 4 — Exploit development (native code / libraries)

If the project is a **library**, perform the following:

```
./code/security-audit/
├── Makefile          ← builds the .so and each PoC with ASAN
├── poc_<vuln>.c      ← minimal reproducer per confirmed finding
└── <lib>.so          ← compiled shared object (ASAN-instrumented)
```

**Makefile template** (adapt as needed):

```makefile
CC      = gcc
CFLAGS  = -g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer
LDFLAGS = -fsanitize=address,undefined

LIB_SRC = $(wildcard ../src/*.c)          # adjust to real source path
LIB_SO  = libvuln.so

all: $(LIB_SO) poc_heap_overflow poc_uaf  # list all PoC targets

$(LIB_SO): $(LIB_SRC)
	$(CC) $(CFLAGS) -shared -fPIC -o $@ $^

poc_%: poc_%.c $(LIB_SO)
	$(CC) $(CFLAGS) -o $@ $< -L. -lvuln -Wl,-rpath,.

clean:
	rm -f $(LIB_SO) poc_*
```

Run each PoC and capture the ASAN / UBSAN report to attach to the finding.

---

### Step 5 Final Submission (Tool: `submit-report`)

Once all local artifacts (PoC, ASAN logs, and Makefile) are generated in the `./code/security-audit/` directory and the vulnerability is **Confirmed**, immediately invoke the `submit-report` tool.

---

## 3. Reporting

For every **confirmed** finding, call the `submit-report` tool **once per
vulnerability** — never combine multiple vulnerabilities into a single report.
Do not report unconfirmed suspects.

The tool defines its own report template (Description, DataFlow, PoC,
Exploitability, Remediation, CVSS). Fill every section completely before
submitting.

---

## 4. Scope Rules

| In scope                              | Out of scope                                             |
| ------------------------------------- | -------------------------------------------------------- |
| Standalone, directly triggerable bugs | Bugs requiring a separate, independent vuln first        |
| All 7 classes listed in §1            | Logic bugs with no memory-safety consequence             |
| Public API surface of libraries       | Dead code unreachable from any entry point               |
| Attacker-controlled input paths       | Issues already mitigated by OS/hardware (ASLR, NX) alone |
| C/C++/Rust(unsafe) native code        | Web apps, APIs, OWASP (→ use `code-audit`)               |
---

## 5. Directory Layout (always use `./code/security-audit/`)

Before writing any file, create the directory:

```bash
mkdir -p ./code/security-audit/
```

Store every artefact here:

- `Makefile`
- `poc_<short_name>.c` (one per confirmed finding)
- `<libname>.so` (the ASAN-instrumented shared object)
- `report.md` (optional: aggregated findings if more than 3)

---

## 6. Quick-Start Checklist

- [ ] Identify language and entry surface
- [ ] Read only relevant source files (not the whole tree)
- [ ] Screen for the 7 vulnerability classes
- [ ] Trace call chain for each candidate
- [ ] For libraries: compile `.so` + PoC under ASAN in `./code/security-audit/`
- [ ] Run PoC, capture ASAN output
- [ ] Write confirmed findings in the §3 format
- [ ] Discard unconfirmed candidates (do not half-report them)