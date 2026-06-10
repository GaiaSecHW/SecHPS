from codedmap.app.contracts.service import CommandRequest, ExecutionContext
from codedmap.app.services.command_executor import CommandExecutor
from codedmap.app.services import command_executor as command_executor_module


def test_execute_internal_error_uses_debug_logger(monkeypatch):
    executor = CommandExecutor()

    def _boom(_validated_input, _context):
        raise ValueError("boom")

    executor.register("query_search", _boom)

    called = {"exception": 0, "debug": 0}

    def _exception(*_args, **_kwargs):
        called["exception"] += 1

    def _debug(*_args, **_kwargs):
        called["debug"] += 1

    monkeypatch.setattr(command_executor_module.logger, "exception", _exception)
    monkeypatch.setattr(command_executor_module.logger, "debug", _debug)

    response = executor.execute(
        CommandRequest(
            tool_name="query_search",
            params={"pattern": "x"},
            context=ExecutionContext(),
        )
    )

    assert response.success is False
    assert response.error_code == "INTERNAL_ERROR"
    assert response.error == "Internal service error: boom"
    assert called["exception"] == 0
    assert called["debug"] == 1
