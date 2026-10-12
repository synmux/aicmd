### GitHub Actions permissions in `.github/workflows/`

The Claude workflow intentionally runs with `pull-requests: read` and `issues: read`. Do not flag these scopes as a critical error or propose changing them to `write`; the token usage in this workflow does not require write access. Only revisit the permission block when a trigger or `claude_args` tool is added that must publish comments or reviews — and call that out with the specific tool or trigger that requires it.
