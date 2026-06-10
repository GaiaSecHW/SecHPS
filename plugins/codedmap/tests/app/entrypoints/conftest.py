# tests/app/entrypoints/conftest.py
"""
Shared fixtures for entry point detection tests.
"""

import pytest
from unittest.mock import Mock, MagicMock
from typing import List, Dict, Any

from codedmap.core.schema.security import (
    EntryPoint,
    EntryPointLevel,
    EntryPointCategory,
)
from codedmap.analysis.detection.entrypoint_detector import EntryPointDetector


class MockNode:
    """Mock CPGNode for testing."""

    def __init__(
        self,
        node_id: int,
        name: str = "",
        label: str = "METHOD",
        file_name: str = "",
        line_number: int = 0,
        code: str = "",
        **kwargs
    ):
        self.id = node_id
        self.name = name
        self.label = label
        self.fileName = file_name
        self.lineNumber = line_number
        self.code = code
        for key, value in kwargs.items():
            setattr(self, key, value)

    def __repr__(self):
        return f"MockNode(id={self.id}, name={self.name}, label={self.label})"


@pytest.fixture
def mock_store():
    """Create a mock CPGStore for testing."""
    store = Mock()
    store.query = Mock()
    store.methods = Mock()
    store.tags = Mock()

    # Setup query mock chain
    store.query.all_nodes = Mock(return_value=Mock())
    store.query.by_id = Mock(return_value=Mock())

    # Setup methods mock
    store.methods.find_by_name = Mock(return_value=[])

    # Setup tags mock
    store.tags.get_all = Mock(return_value=[])
    store.tags.add = Mock()
    store.tags.find_nodes = Mock(return_value=[])

    # Setup neighbor queries
    store.get_neighbors = Mock(return_value=[])
    store.get_node = Mock(return_value=None)

    return store


@pytest.fixture
def mock_config():
    """Create a mock config for testing."""
    config = Mock()
    config.entry_point_trace_depth = 5
    return config


@pytest.fixture
def sample_method_nodes() -> List[MockNode]:
    """Sample METHOD nodes for testing."""
    return [
        MockNode(1, name="main", label="METHOD", file_name="main.c", line_number=10),
        MockNode(2, name="handle_request", label="METHOD", file_name="server.c", line_number=25),
        MockNode(3, name="recv", label="METHOD", file_name="network.c", line_number=100),
        MockNode(4, name="process_data", label="METHOD", file_name="handler.c", line_number=50),
        MockNode(5, name="on_connect", label="METHOD", file_name="callback.c", line_number=30),
    ]


@pytest.fixture
def sample_call_nodes() -> List[MockNode]:
    """Sample CALL nodes for testing."""
    return [
        MockNode(101, name="recv", label="CALL", file_name="server.c", line_number=30,
                 methodFullName="recv"),
        MockNode(102, name="fopen", label="CALL", file_name="file.c", line_number=15,
                 methodFullName="fopen"),
        MockNode(103, name="getenv", label="CALL", file_name="config.c", line_number=20,
                 methodFullName="getenv"),
        MockNode(104, name="socket", label="CALL", file_name="net.c", line_number=10,
                 methodFullName="socket"),
    ]


@pytest.fixture
def sample_identifier_nodes() -> List[MockNode]:
    """Sample IDENTIFIER nodes for testing."""
    return [
        MockNode(201, name="environ", label="IDENTIFIER", file_name="env.c", line_number=5),
        MockNode(202, name="argv", label="IDENTIFIER", file_name="cli.c", line_number=10),
    ]


@pytest.fixture
def detector(mock_store, mock_config):
    """Create an EntryPointDetector with mocked dependencies."""
    return EntryPointDetector(mock_store, mock_config)
