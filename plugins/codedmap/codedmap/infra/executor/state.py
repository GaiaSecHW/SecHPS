"""Pipeline state management for checkpoint/resume support."""

import json
import time
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)


@dataclass
class PassState:
    name: str
    status: str  # "PENDING", "RUNNING", "COMPLETED", "FAILED"
    start_time: float = 0.0
    end_time: float = 0.0
    duration: float = 0.0
    error: Optional[str] = None


class PipelineStateManager:
    """
    Pipeline state manager for checkpoint/resume support.
    Persists execution progress to disk.
    """

    STATE_FILE = ".cpg_build_state.json"

    def __init__(self, workspace: Path):
        workspace.mkdir(parents=True, exist_ok=True)
        self.state_file = workspace / self.STATE_FILE
        self.states: Dict[str, PassState] = {}
        self._load()

    def _load(self):
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text(encoding='utf-8'))
                for name, info in data.items():
                    self.states[name] = PassState(**info)
            except Exception as e:
                logger.warning(f"Failed to load state file: {e}. Starting fresh.")

    def _save(self):
        try:
            data = {name: asdict(state) for name, state in self.states.items()}
            self.state_file.write_text(json.dumps(data, indent=2), encoding='utf-8')
        except Exception as e:
            logger.error(f"Failed to save state: {e}")

    def mark_start(self, pass_name: str):
        self.states[pass_name] = PassState(
            name=pass_name,
            status="RUNNING",
            start_time=time.time()
        )
        self._save()

    def mark_completed(self, pass_name: str):
        if pass_name in self.states:
            s = self.states[pass_name]
            s.status = "COMPLETED"
            s.end_time = time.time()
            s.duration = s.end_time - s.start_time
            self._save()

    def mark_failed(self, pass_name: str, error: str):
        if pass_name in self.states:
            s = self.states[pass_name]
            s.status = "FAILED"
            s.error = str(error)
            s.end_time = time.time()
            self._save()

    def is_completed(self, pass_name: str) -> bool:
        return self.states.get(pass_name, PassState("", "")).status == "COMPLETED"

    def clear(self):
        """Clear all states for force re-run."""
        if self.state_file.exists():
            self.state_file.unlink()
        self.states = {}
