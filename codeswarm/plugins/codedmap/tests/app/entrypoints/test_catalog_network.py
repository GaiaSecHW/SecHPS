"""
Tests for Network entry point rules in the catalog.

Covers:
- NETWORK_LISTENER category rules (V2, replaces HTTP)
- HARDWARE_IRQ category rules (V2, replaces SIGNAL_HANDLER)
- IPC_HANDLER category rules (V2, replaces RPC/WEBSOCKET/MESSAGE_QUEUE)
"""

import pytest

from codedmap.core.schema.security import (
    EntryPointCatalog,
    EntryPointCategory,
    EntryPointRule,
    RulePattern,
)


class TestNetworkListenerRules:
    """Tests for NETWORK_LISTENER category rules (V2)."""

    @pytest.fixture
    def catalog(self) -> EntryPointCatalog:
        """Load default catalog for testing."""
        return EntryPointCatalog.load_default()

    def test_network_listener_rules_exist(self, catalog: EntryPointCatalog):
        """Verify NETWORK_LISTENER rules exist."""
        net_rules = catalog.by_category(EntryPointCategory.NETWORK_LISTENER)
        assert len(net_rules) >= 4, \
            f"Expected >= 4 NETWORK_LISTENER rules, got {len(net_rules)}"

    def test_network_listener_covers_python(self, catalog: EntryPointCatalog):
        """Verify Python NETWORK_LISTENER rules exist."""
        net_rules = catalog.by_category(EntryPointCategory.NETWORK_LISTENER)
        python_net = [r for r in net_rules if "python" in r.languages]
        assert len(python_net) >= 2, \
            f"Expected >= 2 Python NETWORK_LISTENER rules, got {len(python_net)}"

    def test_network_listener_covers_c(self, catalog: EntryPointCatalog):
        """Verify C/C++ NETWORK_LISTENER rules exist."""
        net_rules = catalog.by_category(EntryPointCategory.NETWORK_LISTENER)
        c_net = [r for r in net_rules if "c" in r.languages]
        assert len(c_net) >= 2, \
            f"Expected >= 2 C/C++ NETWORK_LISTENER rules, got {len(c_net)}"

    def test_http_server_python_rule(self, catalog: EntryPointCatalog):
        """Verify Python HTTP server rule exists."""
        rule = catalog.by_name("http_server_python")
        assert rule is not None, "http_server_python rule should exist"
        assert rule.category == EntryPointCategory.NETWORK_LISTENER
        assert "python" in rule.languages

        # Should detect Flask, Django, FastAPI
        functions = [p.function for p in rule.patterns if p.function]
        assert any("flask" in f.lower() or "django" in f.lower() or "fastapi" in f.lower()
                   for f in functions), "Should detect Python web frameworks"

    def test_http_server_c_rule(self, catalog: EntryPointCatalog):
        """Verify C HTTP server rule exists."""
        rule = catalog.by_name("http_server_c")
        assert rule is not None, "http_server_c rule should exist"
        assert rule.category == EntryPointCategory.NETWORK_LISTENER
        assert any(lang in ["c", "cpp"] for lang in rule.languages)

    def test_raw_socket_c_rule(self, catalog: EntryPointCatalog):
        """Verify raw socket rule exists."""
        rule = catalog.by_name("raw_socket_c")
        assert rule is not None, "raw_socket_c rule should exist"
        assert rule.category == EntryPointCategory.NETWORK_LISTENER

        functions = [p.function for p in rule.patterns if p.function]
        assert any("recv" in f or "accept" in f for f in functions), \
            "Should detect recv/accept calls"

    def test_raw_socket_python_rule(self, catalog: EntryPointCatalog):
        """Verify Python raw socket rule exists."""
        rule = catalog.by_name("raw_socket_python")
        assert rule is not None, "raw_socket_python rule should exist"
        assert rule.category == EntryPointCategory.NETWORK_LISTENER
        assert "python" in rule.languages

    def test_v1_http_category_not_in_enum(self):
        """V1 HTTP category should not exist in V2 enum."""
        with pytest.raises(ValueError):
            EntryPointCategory("HTTP")

    def test_full_tag_format(self, catalog: EntryPointCatalog):
        """NETWORK_LISTENER rules should produce correct ONTOLOGY tag."""
        from codedmap.core.schema.security import EntryPoint, EntryPointLevel
        ep = EntryPoint(
            node_id=1, name="handle", file="server.c", line=10,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.NETWORK_LISTENER,
            rule_name="http_server_c",
        )
        assert ep.full_tag == "ONTOLOGY:ENTRY_POINT:NETWORK_LISTENER"


class TestHardwareIRQRules:
    """Tests for HARDWARE_IRQ category rules (V2, replaces SIGNAL_HANDLER)."""

    @pytest.fixture
    def catalog(self) -> EntryPointCatalog:
        """Load default catalog for testing."""
        return EntryPointCatalog.load_default()

    def test_hardware_irq_rules_exist(self, catalog: EntryPointCatalog):
        """Verify HARDWARE_IRQ rules exist."""
        irq_rules = catalog.by_category(EntryPointCategory.HARDWARE_IRQ)
        assert len(irq_rules) >= 2, \
            f"Expected >= 2 HARDWARE_IRQ rules, got {len(irq_rules)}"

    def test_signal_handler_c_rule(self, catalog: EntryPointCatalog):
        """Verify C signal handler rule exists under HARDWARE_IRQ."""
        rule = catalog.by_name("signal_handler_c")
        assert rule is not None, "signal_handler_c rule should exist"
        assert rule.category == EntryPointCategory.HARDWARE_IRQ
        assert any(lang in ["c", "cpp"] for lang in rule.languages)

        functions = [p.function for p in rule.patterns if p.function]
        assert any("signal" in f or "sigaction" in f for f in functions), \
            "Should detect signal/sigaction calls"

    def test_signal_handler_python_rule(self, catalog: EntryPointCatalog):
        """Verify Python signal handler rule exists under HARDWARE_IRQ."""
        rule = catalog.by_name("signal_handler_python")
        assert rule is not None, "signal_handler_python rule should exist"
        assert rule.category == EntryPointCategory.HARDWARE_IRQ
        assert "python" in rule.languages

        functions = [p.function for p in rule.patterns if p.function]
        assert any("signal" in f for f in functions), \
            "Should detect signal.signal calls"

    def test_v1_signal_handler_category_not_in_enum(self):
        """V1 SIGNAL_HANDLER category should not exist in V2 enum."""
        with pytest.raises(ValueError):
            EntryPointCategory("SIGNAL_HANDLER")

    def test_hardware_irq_full_tag(self, catalog: EntryPointCatalog):
        """HARDWARE_IRQ rules should produce correct ONTOLOGY tag."""
        from codedmap.core.schema.security import EntryPoint, EntryPointLevel
        ep = EntryPoint(
            node_id=2, name="irq_handler", file="driver.c", line=20,
            level=EntryPointLevel.L1,
            category=EntryPointCategory.HARDWARE_IRQ,
            rule_name="signal_handler_c",
        )
        assert ep.full_tag == "ONTOLOGY:ENTRY_POINT:HARDWARE_IRQ"


class TestIPCHandlerRules:
    """Tests for IPC_HANDLER category rules (V2, replaces RPC/WEBSOCKET/MESSAGE_QUEUE)."""

    @pytest.fixture
    def catalog(self) -> EntryPointCatalog:
        """Load default catalog for testing."""
        return EntryPointCatalog.load_default()

    def test_ipc_handler_rules_exist(self, catalog: EntryPointCatalog):
        """Verify IPC_HANDLER rules exist."""
        ipc_rules = catalog.by_category(EntryPointCategory.IPC_HANDLER)
        assert len(ipc_rules) >= 2, \
            f"Expected >= 2 IPC_HANDLER rules, got {len(ipc_rules)}"

    def test_v1_rpc_category_not_in_enum(self):
        """V1 RPC category should not exist in V2 enum."""
        with pytest.raises(ValueError):
            EntryPointCategory("RPC")

    def test_v1_websocket_category_not_in_enum(self):
        """V1 WEBSOCKET category should not exist in V2 enum."""
        with pytest.raises(ValueError):
            EntryPointCategory("WEBSOCKET")

    def test_v1_message_queue_category_not_in_enum(self):
        """V1 MESSAGE_QUEUE category should not exist in V2 enum."""
        with pytest.raises(ValueError):
            EntryPointCategory("MESSAGE_QUEUE")

    def test_ipc_handler_full_tag(self):
        """IPC_HANDLER rules should produce correct ONTOLOGY tag."""
        from codedmap.core.schema.security import EntryPoint, EntryPointLevel
        ep = EntryPoint(
            node_id=3, name="rpc_handler", file="rpc.py", line=30,
            level=EntryPointLevel.L2,
            category=EntryPointCategory.IPC_HANDLER,
            rule_name="grpc_python",
        )
        assert ep.full_tag == "ONTOLOGY:ENTRY_POINT:IPC_HANDLER"


class TestNetworkRuleIntegration:
    """Integration tests for network rule filtering."""

    @pytest.fixture
    def catalog(self) -> EntryPointCatalog:
        """Load default catalog for testing."""
        return EntryPointCatalog.load_default()

    def test_all_network_rules_have_description(self, catalog: EntryPointCatalog):
        """All NETWORK_LISTENER rules should have descriptions."""
        net_rules = catalog.by_category(EntryPointCategory.NETWORK_LISTENER)
        for rule in net_rules:
            assert rule.description is not None, \
                f"Rule {rule.name} should have description"
            assert len(rule.description) > 5, \
                f"Rule {rule.name} description too short"

    def test_all_network_rules_have_patterns(self, catalog: EntryPointCatalog):
        """All NETWORK_LISTENER rules should have patterns."""
        net_rules = catalog.by_category(EntryPointCategory.NETWORK_LISTENER)
        for rule in net_rules:
            assert len(rule.patterns) >= 1, \
                f"Rule {rule.name} should have at least one pattern"

    def test_network_rules_language_coverage(self, catalog: EntryPointCatalog):
        """NETWORK_LISTENER rules should cover both Python and C."""
        net_rules = catalog.by_category(EntryPointCategory.NETWORK_LISTENER)
        all_languages = set()
        for rule in net_rules:
            all_languages.update(rule.languages)

        assert "python" in all_languages, "NETWORK_LISTENER rules should cover Python"
        assert "c" in all_languages, "NETWORK_LISTENER rules should cover C"
