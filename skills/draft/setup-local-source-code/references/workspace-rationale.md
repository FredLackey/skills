# Workspace rationale

The source workspace organizes work without defining identity by folder location. Primary clones, optional ticket worktrees, local projects and durable research serve different purposes; all Git hosts use the same layout and commands.

Repository remote host/owner selects an account, with exact repository exceptions and explicit bindings where remotes are ambiguous or absent. The account supplies author name, email and SSH key. This works for normal Git in arbitrary directories. Authentication follows each endpoint; commit signing follows the selected repository identity.

The external configuration is the approved source of routing and identity policy. Native SSH aliases and Git includes expose it to ordinary tools. Narrow Git-invoked guards cover gaps in native configuration: literal URL rewrites cannot express case-insensitive owner matching or every exact-path boundary, and remote includes match any remote without ambiguity rejection. These guards do not require users to clone, fetch or commit through workspace-specific wrapper commands.

SSH commit/tag signing is globally enabled. Missing identity/key stops the operation; no personal fallback or first-agent-key selection masks it. Key names identify personas/companies, and registration labels identify the proper machine and actual registration date. Historical trust survives key migration. Hosting display capabilities do not determine local signing behavior.

Account/API differences are internal protocol capabilities. One workflow handles all accounts without a preferred service, separate provider areas, or service-specific instructions. Tokens remain in account-scoped external files; native Git/SSH works without API credentials.

Direct primary work and optional worktrees are both valid. Case ambiguity, host/path collisions and unsafe replacements stop rather than guessing. Quarantine preserves configuration and working state before risky migrations. Tests use disposable keys and repositories to prove signatures and selection, not merely inspect generated text.

Local configuration supplies reliable defaults rather than an unbypassable security boundary. Repository-side checks are required when accepted history must exclude unsigned commits, other signature formats or unexpected signers.
