"""Operator-provisioned real-mirror probe; run as an unprivileged research identity."""

import json
import os
import sys
from pathlib import Path

from python.research.publisher_policy import EngineeringProposal
from python.research.source_verifier import MirrorTrust, sha, verify

root = Path(sys.argv[1])
assert os.geteuid() != 0
assert not os.access(root / "proposal.json", os.W_OK)
pins = json.loads((root / "trust.json").read_text())
proposal = EngineeringProposal.model_validate_json((root / "proposal.json").read_bytes())
trust = MirrorTrust(root / "mirror.git", **pins)
result = verify(proposal, (root / "candidate-tree").read_text(), trust)
assert not result.receipt.publishAuthority and not result.receipt.testsPassed
assert not result.receipt.dependencyClosureVerified and not result.receipt.remoteFreshnessAttested
assert list(result.files) == [change.path for change in proposal.changes]
for change in proposal.changes:
    assert sha(result.files[change.path]) == change.afterSha256
bad = proposal.model_dump()
bad["changes"][0]["afterSha256"] = "f" * 64
try:
    verify(EngineeringProposal.model_validate(bad), result.receipt.candidateTree, trust)
except ValueError as error:
    assert str(error) == "PUBLISHER_AFTER_EVIDENCE_MISMATCH"
else:
    raise AssertionError("changed bytes accepted")
print(
    json.dumps(
        {
            "unprivileged": True,
            "protectedMirror": True,
            "inertCandidateNotExecuted": True,
            "falseByteClaimRejected": True,
            "receipt": result.receipt.model_dump(),
        }
    )
)
