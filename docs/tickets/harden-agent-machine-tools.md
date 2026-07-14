# The chat agent's machine tools cannot read private or out-of-home paths

## Why

The agent's file and git tools ran in every chat turn with no path boundary. `read_file` and `list_dir` accepted any absolute path on the machine, so credential files such as `~/.ssh` keys or `~/.aws/credentials` could be read and streamed to the configured model provider — including under prompt injection from tool results. `git diff --no-index` could read arbitrary files through the git surface. User-configured MCP servers inherited the full Daylens process environment. This contradicted the product's privacy promise and the boundaries in the agent runtime specification.

## Current behavior

Implemented in this ticket:

- One shared path policy for every machine-read tool: `read_file`, `list_dir`, the `git` repository path, and `search_files` all resolve — symlinks included — to a visible, non-private location inside the user home directory. Hidden segments, `Library`, `AppData`, credentials, dependencies, and build output are denied with an explanatory reason.
- `list_dir` filters hidden and excluded entries; `search_files` skips hidden files inside visible folders instead of matching or previewing them.
- The git argument denylist additionally rejects `--no-index`, `--ext-diff`, `--textconv`, `--git-dir`, and `--work-tree`. `branch` is forced into `--list` mode with its mutating flags denied. Git children run with optional locks off and no credential prompting.
- Agent-spawned child processes — MCP servers and git — inherit only launch essentials (`minimalChildEnv`), never the Daylens process environment; anything else must be set explicitly by the caller or the server's settings entry.
- Tool descriptions and the system prompt now describe the same boundary the code enforces.

## Desired behavior

As above, per the machine-tools boundary in [AI agent](../specs/ai-agent.md) and the user-configured MCP rules in [Agent runtime and context](../specs/agent-runtime-and-context.md).

## Dependencies

None.

## Acceptance checks

- A chat request cannot read, list, or search a dotfile, a `Library` or `AppData` path, or any path outside the home directory, directly or through a symlink.
- `git` requests against repositories outside the home, with filesystem-reading arguments, or with branch-mutating arguments are refused, and no git invocation mutates the repository.
- An MCP server or git child started by the agent does not see Daylens process environment variables beyond the launch essentials.
- Legitimate use still works: reading visible documents, listing visible folders, searching visible files, read-only git in `Dev-*` repositories.

## Verification

- `npm test -- agentTools` — new regression tests cover the allow case, hidden/system/outside denials, symlink escape, git path and argument denials, and the MCP child environment.
- Manual: ask the running agent to read `~/.ssh/id_ed25519` (refused with reason) and a visible Documents file (read).
