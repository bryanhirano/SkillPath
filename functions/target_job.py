"""Callable functions behind the target-job picker on the Skills page.

main.py imports this module *after* initialize_app(), because these handlers
use the database URL configured there. Firebase only deploys functions that
main.py exposes.
"""
from __future__ import annotations

import logging

from firebase_admin import db
from firebase_functions import https_fn, options

from skillpath.catalog import load_catalog
from skillpath.extraction import get_default_tagger
from skillpath.gap import InputError
from skillpath.targets import role_options, select_target

log = logging.getLogger(__name__)

def _require_uid(req: https_fn.CallableRequest) -> str:
    if req.auth is None or not req.auth.uid:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.UNAUTHENTICATED, "Sign in to choose a target job."
        )
    return req.auth.uid


@https_fn.on_call()
def list_target_roles(req: https_fn.CallableRequest) -> dict:
    """Return the selectable roles plus the user's saved target and latest analysis."""
    uid = _require_uid(req)
    profile = db.reference(f"users/{uid}/profile").get() or {}
    latest = None
    latest_id = profile.get("latestAnalysisId")
    if latest_id:
        latest = db.reference(f"users/{uid}/analyses/{latest_id}").get()
    return {
        "status": "success",
        "roles": role_options(load_catalog()),
        "savedTarget": profile.get("target"),
        "latestAnalysis": latest,
    }


# Pasted job descriptions may load the BERT tagger, so match the model functions' sizing.
@https_fn.on_call(
    memory=options.MemoryOption.GB_4,
    cpu=2,
    concurrency=1,
    timeout_sec=300,
)
def select_target_role(req: https_fn.CallableRequest) -> dict:
    """Save the user's target job and, if skills are sent, run the gap analysis.

    data = {target: {roleId} | {title, jobDescription}, skills?: [{skillId, level}],
            preferences?, currentRole?}
    """
    uid = _require_uid(req)
    try:
        result = select_target(req.data or {}, load_catalog(), get_default_tagger)
    except InputError as exc:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(exc)) from exc

    updates = {"target": result["target"], "updatedAt": {".sv": "timestamp"}}
    analysis_id = None
    if result["analysis"] is not None:
        analysis_id = db.reference(f"users/{uid}/analyses").push(result["analysis"]).key
        updates["latestAnalysisId"] = analysis_id
    db.reference(f"users/{uid}/profile").update(updates)

    return {
        "status": "success",
        "target": result["target"],
        "analysisId": analysis_id,
        "analysis": result["analysis"],
    }
