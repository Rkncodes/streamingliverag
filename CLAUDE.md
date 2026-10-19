# Instructions for Claude

## Git and attribution

- Do not add Claude attribution to commits or pull requests: no `Co-Authored-By: Claude` trailer, no
  "Generated with Claude Code" line, no session links. Commits are authored by the repository owner.
- Do not change Git identity (`user.name`, `user.email`, `GIT_AUTHOR_*` / `GIT_COMMITTER_*`) or pass
  `--author`.
- Do not commit, push, open pull requests, or merge unless the owner explicitly asks for that specific
  action. Never force-push or rewrite published history without explicit approval.
- Do not disable hooks (`--no-verify`) or commit signing.
