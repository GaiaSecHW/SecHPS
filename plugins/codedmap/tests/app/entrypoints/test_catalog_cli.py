"""
Tests for CLI entry point rules in the catalog.

Covers:
- CLI rule existence and counts (post Phase 33 V2 enum rewrite)
- Main function detection patterns
- Argument parsing patterns
"""

import pytest

from codedmap.core.schema.security import (
    EntryPointCatalog,
    EntryPointCategory,
    EntryPointRule,
    RulePattern,
)


class TestCLIRules:
    """Tests for CLI_COMMAND category rules (V2)."""

    @pytest.fixture
    def catalog(self) -> EntryPointCatalog:
        """Load default catalog for testing."""
        return EntryPointCatalog.load_default()

    def test_cli_rules_exist(self, catalog: EntryPointCatalog):
        """Verify CLI_COMMAND rules exist for Python and C."""
        cli_rules = catalog.by_category(EntryPointCategory.CLI_COMMAND)

        # Must have at least 4 CLI rules (main_python, argparse, click, main_c)
        assert len(cli_rules) >= 4, f"Expected >= 4 CLI_COMMAND rules, got {len(cli_rules)}"

        # Must cover Python
        python_cli = [r for r in cli_rules if "python" in r.languages]
        assert len(python_cli) >= 3, f"Expected >= 3 Python CLI_COMMAND rules, got {len(python_cli)}"

        # Must cover C/C++
        c_cli = [r for r in cli_rules if "c" in r.languages]
        assert len(c_cli) >= 1, f"Expected >= 1 C/C++ CLI_COMMAND rules, got {len(c_cli)}"

    def test_cli_main_detection(self, catalog: EntryPointCatalog):
        """Verify main function patterns exist."""
        # Python main
        py_main = catalog.by_name("cli_main_python")
        assert py_main is not None, "cli_main_python rule should exist"
        assert py_main.category == EntryPointCategory.CLI_COMMAND
        assert "python" in py_main.languages

        # Should have method pattern for main
        method_patterns = [p for p in py_main.patterns if p.type == "method"]
        assert len(method_patterns) >= 1, "cli_main_python should have method pattern"

        # C/C++ main
        c_main = catalog.by_name("cli_main_c")
        assert c_main is not None, "cli_main_c rule should exist"
        assert c_main.category == EntryPointCategory.CLI_COMMAND
        assert any("c" in lang for lang in c_main.languages)

        # Should have is_entry=True for true entry points
        entry_patterns = [p for p in c_main.patterns if p.is_entry]
        assert len(entry_patterns) >= 1, "cli_main_c should have is_entry=True"

    def test_cli_argparse_patterns(self, catalog: EntryPointCatalog):
        """Verify argument parsing patterns."""
        argparse_rule = catalog.by_name("cli_argparse_python")
        assert argparse_rule is not None, "cli_argparse_python rule should exist"
        assert argparse_rule.category == EntryPointCategory.CLI_COMMAND

        # Should detect argparse calls
        call_patterns = [p for p in argparse_rule.patterns if p.type == "call"]
        assert len(call_patterns) >= 2, "argparse rule should have multiple call patterns"

        # Check for key patterns
        functions = [p.function for p in call_patterns if p.function]
        assert any("argparse" in f.lower() or "ArgumentParser" in f for f in functions)

    def test_cli_click_patterns(self, catalog: EntryPointCatalog):
        """Verify Click framework patterns."""
        click_rule = catalog.by_name("cli_click_python")
        assert click_rule is not None, "cli_click_python rule should exist"

        # Should detect click decorators and prompts
        call_patterns = [p for p in click_rule.patterns if p.type == "call"]
        functions = [p.function for p in call_patterns if p.function]

        assert any("click" in f for f in functions), "Should detect click functions"
        assert any("command" in f or "option" in f for f in functions), "Should detect click decorators"


class TestKernelRules:
    """Tests for IOCTL_HANDLER/SYSCALL_HANDLER category rules (V2)."""

    @pytest.fixture
    def catalog(self) -> EntryPointCatalog:
        """Load default catalog for testing."""
        return EntryPointCatalog.load_default()

    def test_ioctl_rules_exist(self, catalog: EntryPointCatalog):
        """Verify IOCTL_HANDLER rules exist."""
        ioctl_rules = catalog.by_category(EntryPointCategory.IOCTL_HANDLER)
        assert len(ioctl_rules) >= 2, f"Expected >= 2 IOCTL_HANDLER rules, got {len(ioctl_rules)}"

        # All ioctl rules should be C/C++ only
        for rule in ioctl_rules:
            assert all(lang in ["c", "cpp"] for lang in rule.languages), \
                f"Ioctl rule {rule.name} should be C/C++ only"

    def test_syscall_rules_exist(self, catalog: EntryPointCatalog):
        """Verify SYSCALL_HANDLER rules exist."""
        syscall_rules = catalog.by_category(EntryPointCategory.SYSCALL_HANDLER)
        assert len(syscall_rules) >= 3, f"Expected >= 3 SYSCALL_HANDLER rules, got {len(syscall_rules)}"

        # All syscall rules should be C/C++ only
        for rule in syscall_rules:
            assert all(lang in ["c", "cpp"] for lang in rule.languages), \
                f"Syscall rule {rule.name} should be C/C++ only"

    def test_kernel_ioctl_rule(self, catalog: EntryPointCatalog):
        """Verify ioctl handler detection patterns."""
        ioctl_rule = catalog.by_name("kernel_ioctl_c")
        assert ioctl_rule is not None, "kernel_ioctl_c rule should exist"
        assert ioctl_rule.category == EntryPointCategory.IOCTL_HANDLER

        # Should detect unlocked_ioctl and compat_ioctl
        names = [p.name for p in ioctl_rule.patterns if p.name]
        assert any("ioctl" in n.lower() for n in names), "Should detect ioctl methods"

    def test_kernel_syscall_rule(self, catalog: EntryPointCatalog):
        """Verify syscall handler detection patterns."""
        syscall_rule = catalog.by_name("kernel_syscall_c")
        assert syscall_rule is not None, "kernel_syscall_c rule should exist"
        assert syscall_rule.category == EntryPointCategory.SYSCALL_HANDLER

        # Should detect SYSCALL_DEFINE and sys_ functions
        identifiers = [p.name for p in syscall_rule.patterns if p.type == "identifier"]
        assert any("SYSCALL" in i or "sys_" in i for i in identifiers), \
            "Should detect SYSCALL_DEFINE or sys_ patterns"

    def test_kernel_proc_rule(self, catalog: EntryPointCatalog):
        """Verify /proc interface detection patterns."""
        proc_rule = catalog.by_name("kernel_proc_c")
        assert proc_rule is not None, "kernel_proc_c rule should exist"
        assert proc_rule.category == EntryPointCategory.SYSCALL_HANDLER

        functions = [p.function for p in proc_rule.patterns if p.function]
        assert any("proc_create" in f for f in functions), "Should detect proc_create"

    def test_kernel_netlink_rule(self, catalog: EntryPointCatalog):
        """Verify netlink socket detection patterns."""
        netlink_rule = catalog.by_name("kernel_netlink_c")
        assert netlink_rule is not None, "kernel_netlink_c rule should exist"
        assert netlink_rule.category == EntryPointCategory.SYSCALL_HANDLER

        functions = [p.function for p in netlink_rule.patterns if p.function]
        assert any("netlink" in f.lower() for f in functions), "Should detect netlink functions"

    def test_kernel_chardev_rule(self, catalog: EntryPointCatalog):
        """Verify character device detection patterns."""
        chardev_rule = catalog.by_name("kernel_chardev_c")
        assert chardev_rule is not None, "kernel_chardev_c rule should exist"
        assert chardev_rule.category == EntryPointCategory.IOCTL_HANDLER

        functions = [p.function for p in chardev_rule.patterns if p.function]
        assert any("cdev" in f or "chrdev" in f for f in functions), \
            "Should detect cdev or chrdev functions"


class TestCLIRuleIntegration:
    """Integration tests for CLI_COMMAND rule filtering."""

    @pytest.fixture
    def catalog(self) -> EntryPointCatalog:
        """Load default catalog for testing."""
        return EntryPointCatalog.load_default()

    def test_cli_rules_filter_by_python(self, catalog: EntryPointCatalog):
        """Verify CLI_COMMAND rules can be filtered by Python language."""
        python_rules = catalog.by_language("python")
        cli_python = [r for r in python_rules if r.category == EntryPointCategory.CLI_COMMAND]

        assert len(cli_python) >= 3, "Should have at least 3 Python CLI_COMMAND rules"

        rule_names = [r.name for r in cli_python]
        assert "cli_main_python" in rule_names
        assert "cli_argparse_python" in rule_names

    def test_cli_rules_filter_by_c(self, catalog: EntryPointCatalog):
        """Verify CLI_COMMAND rules can be filtered by C language."""
        c_rules = catalog.by_language("c")
        cli_c = [r for r in c_rules if r.category == EntryPointCategory.CLI_COMMAND]

        assert len(cli_c) >= 1, "Should have at least 1 C CLI_COMMAND rule"

        rule_names = [r.name for r in cli_c]
        assert "cli_main_c" in rule_names

    def test_all_cli_rules_have_description(self, catalog: EntryPointCatalog):
        """All CLI_COMMAND rules should have human-readable descriptions."""
        cli_rules = catalog.by_category(EntryPointCategory.CLI_COMMAND)

        for rule in cli_rules:
            assert rule.description is not None, f"Rule {rule.name} should have description"
            assert len(rule.description) > 10, f"Rule {rule.name} description too short"

    def test_all_cli_rules_have_patterns(self, catalog: EntryPointCatalog):
        """All CLI_COMMAND rules should have at least one pattern."""
        cli_rules = catalog.by_category(EntryPointCategory.CLI_COMMAND)

        for rule in cli_rules:
            assert len(rule.patterns) >= 1, f"Rule {rule.name} should have patterns"
