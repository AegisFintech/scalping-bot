Derive execution from a validated fresh mode-neutral Codex range, operator-selected
mode and immutable mode revision. Preserve upper/lower prices exactly.
OCO_STOP_LIMIT: BUY upper, SELL lower. OCO_LIMIT: BUY lower, SELL upper.
SINGLE_STOP_LIMIT: original Codex direction at its original trigger.
SINGLE_LIMIT: opposite Codex direction AT THE SAME original trigger.
Native stop and TP retain equal distance of box width plus one tick, inward pip
rounded; mirror direction for LIMIT. Never clamp, chase, invent a peer, override
WAIT, reset accounting or bypass fresh-data/session/ownership/risk/reconciliation.
Both OCO legs share the setup ceiling; each single keeps its half allocation.
Persist profile/revision, actual orders and original provider judgment separately.
Accepted GTC/protection retain their immutable original profile after a switch.
