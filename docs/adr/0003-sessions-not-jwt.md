# ADR 0003 — Server-side sessions in httpOnly cookies instead of JWTs

**Status:** accepted

**Decision.** On login the server creates a random 256-bit token, stores only its SHA-256 in
`sessions`, and sets it in an `httpOnly; SameSite=Strict; Secure (prod)` cookie. Each request
looks the session up. State-changing requests additionally require the `x-bitebrew-client`
header (CSRF defence in depth).

**Why.** Shared café tablets need instant revocation: sign-out, role change, deactivation and
password reset must end access immediately — verified by tests. JWTs cannot be revoked
without a server-side denylist, which removes their advantage. The DB lookup cost is
negligible at café scale.
