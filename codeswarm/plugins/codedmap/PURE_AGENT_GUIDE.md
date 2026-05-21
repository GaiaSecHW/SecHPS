# Pure Agent Code Audit Guide

> AI Agent Code Security Audit Methodology — No External Tools Required
>
> Version: v1.0 | Last updated: 2026-03-20

This guide is for **AI Agents** performing code security audits. This methodology does NOT depend on CodeDMap or any other external tool — it relies entirely on the agent's own capabilities: source code reading, pattern recognition, and semantic understanding.

---

## Table of Contents

0. [Core Concepts: AI-Driven Code Audit](#0-core-concepts-ai-driven-code-audit)
1. [Quick Start](#1-quick-start)
2. [Audit Methodology](#2-audit-methodology)
3. [Hybrid Audit Workflow (Three-Phase)](#3-hybrid-audit-workflow-three-phase)
4. [Vulnerability Discovery Methodology](#4-vulnerability-discovery-methodology)
5. [Source Code Analysis Techniques](#5-source-code-analysis-techniques)
6. [Vulnerability Verification Process](#6-vulnerability-verification-process)
7. [Audit Documentation Standards](#7-audit-documentation-standards)
8. [Common Vulnerability Pattern Library](#8-common-vulnerability-pattern-library)

---

## 0. Core Concepts: AI-Driven Code Audit

> **Core principle**: An AI Agent reads source code, understands semantics, and recognizes patterns to autonomously discover security vulnerabilities. No static analysis tools required — the agent leverages its semantic understanding and reasoning capabilities directly.

### Audit Capability Model

```
+------------------------------------------------------------+
|                    AI Agent Audit Capabilities              |
+------------------------------------------------------------+
|                                                             |
|  +-------------+  +-------------+  +-------------+         |
|  | Source Read |  |  Pattern    |  |  Semantic   |         |
|  |             |  | Recognition |  | Understand  |         |
|  | - File nav  |  | - Dangerous |  | - Business  |         |
|  | - Code grep |  |   functions |  |   logic     |         |
|  | - Context   |  | - Vuln      |  | - Data flow |         |
|  |   building  |  |   patterns  |  | - Control   |         |
|  |             |  | - Attack    |  |   flow      |         |
|  |             |  |   patterns  |  |             |         |
|  +-------------+  +-------------+  +-------------+         |
|         |                |                |                 |
|         +----------------+----------------+                 |
|                          |                                  |
|                          v                                  |
|                  +--------------+                           |
|                  |  Vuln        |                           |
|                  |  Discovery   |                           |
|                  |              |                           |
|                  | - Dangerous  |                           |
|                  |   func class |                           |
|                  | - Semantic   |                           |
|                  |   vulns      |                           |
|                  | - Logic bugs |                           |
|                  +--------------+                           |
|                                                             |
+------------------------------------------------------------+
```

### Two Audit Approaches Compared

```
+-----------------------------------------------------------------------------+
|                        Audit Methodology Comparison                          |
+-----------------------------------------------------------------------------+
|                                                                              |
|  Approach 1: Dangerous Function Search                                       |
|  --------------------------------------------------------------------------  |
|  Start: memcpy, strcpy, popen, system, sprintf, exec...                     |
|  Direction: Backward analysis (from dangerous function to user input)        |
|  Pros: High efficiency, clear targets                                        |
|  Cons: Only finds "dangerous function" related bugs; misses semantic vulns   |
|                                                                              |
|  Approach 2: Attack Entry Point Tracing                                      |
|  --------------------------------------------------------------------------  |
|  Start: main() args, env vars, network input, file input...                 |
|  Direction: Forward analysis (from user input to sensitive operations)       |
|  Pros: Comprehensive coverage, finds semantic-level vulns                    |
|  Cons: Lower efficiency, requires understanding complete data flow           |
|                                                                              |
|  Best Practice: Use both (dangerous-function search first for quick scan,   |
|  then attack entry tracing for deep analysis)                                |
|                                                                              |
+-----------------------------------------------------------------------------+
```

---

## 1. Quick Start

### 1.1 Project Overview

First, understand the basics of the project:

```markdown
1. List project directory structure to understand code organization
2. Identify the main language and framework
3. Find the entry files (main.c, main.py, index.js, etc.)
4. Identify key modules and configuration files
```

### 1.2 Quick Scan

```markdown
1. Search for dangerous functions: memcpy, strcpy, popen, system, sprintf
2. Search for sensitive operations: open, stat, unlink, setuid, getenv
3. Trace user input flow starting from entry points
```

### 1.3 Deep Analysis

```markdown
1. Read key function source code
2. Analyze data flow and control flow
3. Check security protections
4. Validate vulnerability exploitability
```

---

## 2. Audit Methodology

### 2.1 Information Gathering

**Goal**: Comprehensive understanding of project structure and attack surface

| Task | Method |
|------|--------|
| **Directory structure** | List project dirs, identify source locations |
| **Entry files** | Search for main functions, entry scripts |
| **Configuration files** | Find config files, understand dependencies |
| **Documentation** | Read README, docs to understand project functionality |

### 2.2 Attack Surface Identification

**Goal**: Identify all user input entry points

| Entry Type | Search Pattern | Risk Level |
|-----------|---------------|------------|
| **CLI args** | `int main(int argc, char **argv)` | High |
| **Environment variables** | `getenv`, `environ` | Medium |
| **Network input** | `recv`, `read`, `accept` | High |
| **File input** | `fread`, `fgets`, `open` | Medium |
| **User input** | `scanf`, `gets`, `input()` | High |

### 2.3 Sensitive Operation Identification

**Goal**: Identify all sensitive operation points

| Operation Type | Function Examples | Risk Type |
|--------------|------------------|-----------|
| **Memory ops** | memcpy, strcpy, strcat, sprintf | Buffer overflow |
| **Command exec** | popen, system, exec, execl | Command injection |
| **File ops** | open, stat, unlink, chmod, chown | Path traversal |
| **Network ops** | send, recv, connect, accept | Info leakage |
| **Privilege ops** | setuid, setgid, chroot | Privilege escalation |
| **Database ops** | sql, query, execute | SQL injection |

---

## 3. Hybrid Audit Workflow (Three-Phase)

### Phase 1: Dangerous Function Search (Quick Scan)

**Goal**: Quickly find common vulnerabilities, efficiency first

```
Phase 1 Workflow:

1. Project overview
   - List directory structure
   - Identify entry files
   - Understand project functionality

2. Search for dangerous functions
   - Memory ops: memcpy, strcpy, strcat, sprintf
   - Command exec: popen, system, exec
   - Format ops: printf, sprintf, fprintf
   - Memory mgmt: malloc, free, realloc

3. Analyze each dangerous function
   - Read function context
   - Trace parameter source
   - Determine if user-controllable

4. Record findings
   - Confirmed vuln -> record details
   - Suspicious -> mark for verification
```

**Search patterns**:

```markdown
Search in source code for these patterns:
- memcpy\s*\(                    # memory copy
- strcpy\s*\(                    # string copy
- strcat\s*\(                    # string concat
- sprintf\s*\(                   # formatted output
- popen\s*\(                     # pipe execution
- system\s*\(                    # system command
- exec[vl]?[pe]?\s*\(            # exec functions
```

**Detectable vulnerabilities**:
- Buffer overflow (memcpy/strcpy/strcat)
- Command injection (popen/system/exec)
- Format string (printf/sprintf)
- Memory management issues (malloc/free)

### Phase 2: Attack Entry Tracing (Deep Analysis)

**Goal**: Find semantic-level vulnerabilities with full coverage

```
Phase 2 Workflow:

1. Identify all attack entry points
   - CLI args: argc, argv
   - Env vars: getenv()
   - Network: recv(), read()
   - File: fread(), fgets()

2. Forward-trace data flow
   - Start from entry points
   - Track variable passing
   - Record data flow path

3. Check sensitive operations
   - File ops: open, stat, unlink
   - Privilege ops: setuid, setgid
   - Network ops: send, write

4. Analyze security protections
   - Input validation
   - Path normalization
   - Permission checks
```

**Data flow tracing method**:

```markdown
1. Get user input variable from entry point
2. Track all uses of the variable:
   - Assigned to other variables
   - Passed as function argument
   - Involved in operations or concatenation
3. Check what operation the variable ultimately reaches
4. Determine if security risk exists
```

**Detectable vulnerabilities**:
- All Phase 1 vulnerabilities
- Path traversal (user input -> open)
- Privilege escalation (user input -> setuid)
- Info leakage (user input -> send/write)
- Business logic vulnerabilities

### Phase 3: Semantic Analysis (Supplemental Validation)

**Goal**: Validate exploitability, find business logic vulnerabilities

```
Phase 3 Workflow:

1. Deep source code reading
   - Understand function logic
   - Analyze call relationships
   - Understand business semantics

2. Validate vulnerability exploitability
   - Construct attack input
   - Analyze trigger conditions
   - Evaluate impact scope

3. Business logic analysis
   - Understand business flow
   - Identify logic vulnerabilities
   - Analyze permission model

4. Final confirmation
   - Confirm vulnerability exists
   - Evaluate severity
   - Propose remediation
```

### Complete Workflow Diagram

```
+-----------------------------------------------------------------------------+
|                         Hybrid Audit Workflow                                |
+-----------------------------------------------------------------------------+
|                                                                              |
|  Phase 1: Dangerous Function Search                                          |
|  Dir structure -> entry files -> search dangerous funcs -> trace args       |
|  Finds: buffer overflow, command injection, format string, memory issues    |
|  Speed: High | False positives: Low | False negatives: High (semantic)      |
|                                |                                             |
|                                v                                             |
|  Phase 2: Attack Entry Tracing                                               |
|  Identify entries -> trace data flow -> check sensitive ops -> check guards |
|  Finds: path traversal, privilege escalation, info leak, logic vulns        |
|  Speed: Medium | False positives: Medium | False negatives: Low             |
|                                |                                             |
|                                v                                             |
|  Phase 3: Semantic Analysis                                                  |
|  Deep read -> validate exploitability -> business logic -> final confirm    |
|  Finds: logic vulns, validates exploitability                                |
|  Speed: Low | Accuracy: High | Value: Validation + supplementation          |
|                                                                              |
+-----------------------------------------------------------------------------+
```

---

## 4. Vulnerability Discovery Methodology

### 4.1 Vulnerability Classification and Detection Methods

| Vulnerability Type | Detection Method | Difficulty |
|-------------------|-----------------|------------|
| **Buffer overflow** | Search memcpy/strcpy + trace arg source | Low |
| **Command injection** | Search popen/system + analyze command construction | Low |
| **Format string** | Search printf/sprintf + check format string | Low |
| **SQL injection** | Search SQL ops + analyze query construction | Medium |
| **Path traversal** | Entry point tracing + file op analysis | Medium |
| **Privilege escalation** | Entry point tracing + privilege op analysis | High |
| **Information leakage** | Entry point tracing + network op analysis | Medium |
| **Business logic vuln** | Deep semantic analysis | High |
| **Race condition** | Timing analysis | High |

### 4.2 Sensitive Operation Checklist

When user input reaches the following operations, check for security protections:

#### File Operation Risk

**Search patterns**:
```markdown
Search in source code for:
- open\s*\(
- stat\s*\(
- unlink\s*\(
- chmod\s*\(
- chown\s*\(
- rename\s*\(
```

**Check items**:
- [ ] Path normalization (realpath) present?
- [ ] Path whitelist present?
- [ ] chroot isolation?
- [ ] Symlink check?
- [ ] File type validation?

#### Privilege Operation Risk

**Search patterns**:
```markdown
Search in source code for:
- setuid\s*\(
- setgid\s*\(
- chroot\s*\(
- chmod\s*\(
- chown\s*\(
```

**Check items**:
- [ ] Permission check present?
- [ ] User identity verification?
- [ ] Audit logging?
- [ ] Principle of least privilege?

#### Network Operation Risk

**Search patterns**:
```markdown
Search in source code for:
- send\s*\(
- recv\s*\(
- connect\s*\(
- accept\s*\(
- socket\s*\(
```

**Check items**:
- [ ] Input validation?
- [ ] Output encoding?
- [ ] Rate limiting?
- [ ] Encrypted transport?

---

## 5. Source Code Analysis Techniques

### 5.1 File Traversal Strategy

```
File Traversal Priority:

Priority 1 (Must review):
  - Entry files (main.c, main.py, index.js)
  - Core business logic files
  - Network handling files
  - File operation files

Priority 2 (Spot check):
  - Business logic code
  - Config parsing code
  - Utility functions

Priority 3 (Optional):
  - Test code
  - Example code
  - Documentation

Traversal methods:
  - Breadth-first: review all entry points first, then dive into each branch
  - Depth-first: start from entry point, trace complete data flow
```

### 5.2 Data Flow Tracing Techniques

**Method 1: Variable Tracing**

```markdown
1. Identify user input variable (e.g., argv[1], getenv() return value)
2. Search all uses of the variable
3. Track variable assignment and passing
4. Find what sensitive operation the variable ultimately reaches
```

**Method 2: Function Call Chain Tracing**

```markdown
1. Start from entry function
2. Analyze sub-functions called
3. Track parameter passing
4. Find sensitive operation functions
```

**Method 3: Backward Tracing**

```markdown
1. Start from sensitive operation
2. Analyze parameter source
3. Backward trace to user input
4. Confirm data flow path
```

### 5.3 Code Pattern Recognition

**Dangerous pattern library**:

| Pattern | Example | Risk |
|---------|---------|------|
| **Copy without length check** | `strcpy(dst, src)` | Buffer overflow |
| **User input in command concat** | `sprintf(cmd, "ls %s", user_input)` | Command injection |
| **User input as path** | `open(user_path, ...)` | Path traversal |
| **Controllable format string** | `printf(user_input)` | Format string |
| **Permission op without check** | `setuid(user_id)` | Privilege escalation |

---

## 6. Vulnerability Verification Process

### 6.1 Verification Steps

```
Vulnerability Verification Workflow:

1. Confirm vulnerability exists
   - Read related code
   - Understand trigger conditions
   - Confirm data flow path

2. Construct attack input
   - Identify attack entry point
   - Construct malicious input
   - Analyze expected effect

3. Evaluate impact
   - Attack complexity
   - Impact scope
   - Severity

4. Document finding
   - Vulnerability description
   - Attack path
   - PoC (if applicable)
   - Remediation recommendation
```

### 6.2 Vulnerability Report Template

```markdown
## Vulnerability Report

### Basic Information
- **Vulnerability Type**: [Command Injection / Buffer Overflow / Path Traversal / ...]
- **Severity**: [Critical / High / Medium / Low]
- **Confidence**: [High / Medium / Low]

### Location
- **File**: [file path]
- **Line**: [line number]
- **Function**: [function name]

### Description
[Detailed description of vulnerability principle and trigger conditions]

### Attack Path
```
User Input -> Intermediate Processing -> Sensitive Operation
```

### PoC (if applicable)
```
[Attack code or input example]
```

### Impact Assessment
- **Attack Complexity**: [Low / Medium / High]
- **Impact Scope**: [description]
- **Potential Harm**: [description]

### Remediation Recommendation
[Specific remediation approach]
```

---

## 7. Audit Documentation Standards

### 7.1 Finding Classification

| Classification | Description | Example |
|---------------|-------------|---------|
| **Confirmed Vulnerability** | Confirmed, exploitable | Command injection, buffer overflow |
| **Potential Risk** | Needs further verification | Path traversal risk |
| **Security Recommendation** | Not a vuln, but improvable | Suggest adding input validation |
| **Audited Clean** | Reviewed, no issues | Reviewed, has security protections |

### 7.2 Confidence Assessment

| Confidence | Description | Conditions |
|-----------|-------------|-----------|
| **High (0.9-1.0)** | Confirmed vulnerability with PoC | Clear data flow, constructable attack |
| **Medium (0.7-0.9)** | Very likely vulnerable | Data flow mostly clear, needs verification |
| **Low (0.5-0.7)** | Suspicious, needs more analysis | Incomplete data flow, needs confirmation |

---

## 8. Common Vulnerability Pattern Library

### 8.1 Command Injection

**Pattern**:
```c
// Dangerous pattern
sprintf(cmd, "ls %s", user_input);
popen(cmd, "r");

// Safe pattern
snprintf(cmd, sizeof(cmd), "ls %s", escaped_input);
```

**Checkpoints**:
- [ ] Is user input concatenated into command string?
- [ ] Is there input validation/escaping?
- [ ] Is parameterized execution used?

### 8.2 Buffer Overflow

**Pattern**:
```c
// Dangerous pattern
char buf[100];
strcpy(buf, user_input);

// Safe pattern
char buf[100];
strncpy(buf, user_input, sizeof(buf) - 1);
buf[sizeof(buf) - 1] = '\0';
```

**Checkpoints**:
- [ ] Is there a length check?
- [ ] Is the destination buffer large enough?
- [ ] Are safe functions used (strncpy, snprintf)?

### 8.3 Path Traversal

**Pattern**:
```c
// Dangerous pattern
open(user_path, O_RDONLY);

// Safe pattern
char resolved[PATH_MAX];
if (realpath(user_path, resolved) && is_in_safe_dir(resolved)) {
    open(resolved, O_RDONLY);
}
```

**Checkpoints**:
- [ ] Is there path normalization?
- [ ] Are `..` and symlinks checked?
- [ ] Is there a path whitelist?

### 8.4 Format String

**Pattern**:
```c
// Dangerous pattern
printf(user_input);

// Safe pattern
printf("%s", user_input);
```

**Checkpoints**:
- [ ] Is the format string user-controllable?
- [ ] Is a fixed format string used?

### 8.5 Integer Overflow

**Pattern**:
```c
// Dangerous pattern
int size = a + b;
malloc(size);

// Safe pattern
if (a > INT_MAX - b) { error(); }
int size = a + b;
malloc(size);
```

**Checkpoints**:
- [ ] Can the arithmetic result overflow?
- [ ] Does overflow affect security decisions?

---

## Appendix A: Audit Checklist

### A.1 Entry Point Analysis

- [ ] Identify all CLI argument entry points (argv)
- [ ] Identify all environment variable entry points
- [ ] Identify all network entry points
- [ ] Identify all file input entry points
- [ ] Identify all database entry points

### A.2 Dangerous Function Check

- [ ] Memory ops: memcpy, strcpy, strcat, sprintf
- [ ] Command exec: popen, system, exec
- [ ] Format ops: printf, sprintf, fprintf
- [ ] Memory mgmt: malloc, free, realloc

### A.3 Sensitive Operation Check

- [ ] File ops: open, stat, unlink, chmod
- [ ] Network ops: send, recv, connect
- [ ] Privilege ops: setuid, setgid, chroot
- [ ] Database ops: sql, query, execute

### A.4 Security Protection Check

- [ ] Input validation
- [ ] Output encoding
- [ ] Path normalization
- [ ] Permission checks
- [ ] Rate limiting
- [ ] Encrypted transport

---

## Appendix B: Audit Efficiency Optimization

### B.1 Priority Strategy

```
High priority (must audit):
  - Entry functions
  - Dangerous function calls
  - Network handling code
  - File operation code

Medium priority (spot check):
  - Business logic code
  - Config parsing code
  - Utility functions

Low priority (optional):
  - Test code
  - Example code
  - Documentation
```

### B.2 Time Allocation Guide

```
Phase 1 (Dangerous function search):  30% of time
Phase 2 (Attack entry tracing):       40% of time
Phase 3 (Semantic validation):        30% of time
```

---

*This guide is for pure AI Agent code auditing without any external tool dependency.*
