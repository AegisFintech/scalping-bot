# ISSUE-400 replay draft checkpoint

This is unfinished offline research code. The CLI intentionally refuses to run;
no trading, broker, provider, automatic promotion or deployment authority exists.
The draft has 25 focused tests; that is not economic qualification.

Remaining work includes exact position identity and remaining-volume checks,
execution mode and group/order deadline consistency, closing-fill ambiguity,
uncertainty/terminal/session ordering regressions, reviewed source and spec
reviews, versioned schemas and fixtures, protocol limitations, full qualification,
and a reviewed PR. Historical raw broker GTD/range acknowledgements were discarded;
issue #407 tracks prospective evidence. Unknown costs and counterfactual fills
must remain null. Do not use a draft protocol to register or promote a strategy.

The previous paired replay and frozen prospective registrations remain immutable.
