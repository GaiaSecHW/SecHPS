# codedmap/app/audit/__init__.py
"""Audit package exports."""

from .models import AuditConfig, AuditEvent, AuditSession, Candidate, EvidenceBundle, EvidencePath

__all__ = ["AuditFacade", "AuditConfig", "AuditEvent", "AuditSession", "Candidate", "EvidenceBundle", "EvidencePath"]


def __getattr__(name: str):
    if name == "AuditFacade":
        from .facade import AuditFacade

        return AuditFacade
    raise AttributeError(name)
