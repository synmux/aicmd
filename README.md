# `aicmd`

Turn a natural-language task into a shell command with Claude — see it,
confirm it, run it. Uses your **Claude Code subscription**, not an API key.

```console
$ aicmd list the five largest files here

────────────────────────────────────────────────
find . -maxdepth 1 -type f -exec stat -f '%z %N' {} + | sort -rn | head -5
────────────────────────────────────────────────
Lists the five largest files in the current directory by size.

Run this command? [y/N/e]
```

`aicmd` asks the model through the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) with a
**structured output schema**, so the response is a parsed object — command,
one-line explanation, and the model's own danger assessment — never mangled
markdown to regex apart. A local guard-pattern list (`rm`, `dd of=/dev/…`,
`curl | sh`, force-pushes, …) provides a second, independent danger signal.

## Install

```sh
bun add -g @synmux/aicmd     # or: npm install -g @synmux/aicmd
```

Both `aicmd` and the shorter `ai` are installed. Bun is the preferred runtime
and is picked up automatically when present; plain Node (≥ 22.12) works too —
the launcher runs the bundled build, so no TypeScript support is required.

From a checkout:

```sh
bun install
bun run bin/aicmd.ts --help
```

## Authentication

`aicmd` authenticates with your Claude Code subscription session (run
`claude login` once). To protect you from surprise pay-as-you-go charges, API
credentials in your environment (`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`)
are **ignored by default**: they are stripped from the environment passed to
the model subprocess, and a one-line notice is printed to stderr. To bill an
API key instead, opt in explicitly in your configuration:

```json
{ "allowApiKey": true }
```

## Usage

```sh
aicmd [options] [task...]
```

The task can be argv words (quoting optional), piped stdin
(`echo task | aicmd`), or typed at a prompt when you pass nothing. Options are
read only **before the first task word**, so flag-shaped words inside the task
(`ls -la`, `up -d`) are left alone; when the task itself _starts_ with a
flag-shaped word, put `--` first (`aicmd -- -x is part of this task`).

| Flag                                     | Description                                                          |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `-x, --execute`                          | Run without a confirmation prompt (dangerous commands still refused) |
| `-f, --force`                            | With `-x`: run even when the command is flagged dangerous            |
| `-d, --dry-run`                          | Print the command to stdout and exit (pipe-safe)                     |
| `-i, --interactive` / `--no-interactive` | Pick between several candidates in a TUI (ignored under `-x`/`-d`)   |
| `-n, --count <n>`                        | Candidates to generate in interactive mode (default 3, max 25)       |
| `-m, --model <model>`                    | Model to use (default `sonnet`)                                      |
| `-s, --shell <shell>`                    | Shell to generate for and execute with (default `$SHELL`)            |
| `-p, --prompt <text>`                    | Extra instructions appended to the prompt                            |
| `--no-context`                           | Omit the platform/shell context block from the prompt                |
| `--no-spinner`                           | Disable the progress spinner                                         |
| `--config <path>`                        | Path to a config file                                                |
| `-v, --verbose`                          | Print cost, model and debug output on stderr                         |

### Examples

```sh
aicmd list the five largest files here        # generate → confirm → run
aicmd -x convert screenshot.png to webp       # run immediately (if safe)
aicmd -i find every TODO in tracked files     # pick from candidates in a TUI
aicmd -d "tar this directory" | pbcopy        # just the command, to clipboard
echo 'kill whatever listens on :3000' | aicmd -x
```

Without a TTY (a pipe, CI) there is no way to confirm, so `aicmd` prints the
command to stdout instead of running it — `aicmd "..." | sh` composes. Only
the command ever goes to stdout; every warning and note stays on stderr.

## Safety

Two independent signals decide whether a command is dangerous:

1. **Guard patterns** matched locally against the command text. Defaults
   cover `rm` (including `/bin/rm` and the `\rm` alias bypass), `shred`,
   `find -delete`, `rsync --delete`, `truncate -s 0`, `crontab -r`,
   `chmod 777`, recursive `chown`, raw-device writes,
   `mkfs`/`fdisk`/`diskutil erase`, fork bombs, `curl|sh` / `wget|sh`
   (through any number of pipe stages), shutdown/reboot, `git push --force`,
   `git reset --hard`, `git clean -f`.
2. **The model's own assessment** — the `dangerous` flag and reason from the
   structured response, which covers everything a pattern list cannot.

Commands carrying control characters (`\r`, escape sequences) or literal
newlines are rejected outright rather than displayed: what you confirm must
be exactly what runs, and a smuggled carriage return could make the two
differ on screen.

What happens then depends on the mode:

| Mode          | Safe command      | Dangerous command                        |
| ------------- | ----------------- | ---------------------------------------- |
| default (TTY) | confirm `[y/N/e]` | warning with reasons + confirm `[y/N/e]` |
| `-x`          | runs immediately  | **refused**, exit 1, `-f` suggested      |
| `-x -f`       | runs immediately  | loud warning, runs anyway                |
| `-d` / no TTY | printed to stdout | printed to stdout, warning on stderr     |

On the rare setups where structured output is unavailable, generation falls
back to plain text and the model's danger signal is lost. That degradation is
never silent: every mode prints a note, and `-x` **refuses to auto-execute**
on the pattern list alone (`-f` remains the escape hatch).

The confirmation default is **No** — running a generated command takes a
deliberate keypress. `e` opens the command in your `$EDITOR`
(`GIT_EDITOR` ▸ `VISUAL` ▸ `EDITOR` ▸ `vi`) and then runs your edited text
(the guard patterns still warn about it). EOF or Ctrl-C at the prompt counts
as No.

## Interactive mode

`aicmd -i` generates several candidates (higher temperature for variety) and
opens a TUI list: ↑/↓ or `j`/`k` to move, ⏎ to run, `e` to edit first,
`q`/Esc to cancel. Dangerous candidates are marked `⚠`, and running one with
⏎ still goes through the full warning + confirmation — one keypress is never
enough to run something destructive. `e` hands the command to your `$EDITOR`
and runs what you save (with a pattern warning where it applies). If the TUI
cannot initialize, a plain numbered prompt takes over.

Set `"interactive": true` in config to make this the default; `--no-interactive`
opts out per run. Without a TTY the setting quietly degrades to printing.

## Configuration

Layered, lowest to highest precedence:

1. Built-in defaults.
2. **Global**: `~/.config/aicmd/config.json` (or
   `$XDG_CONFIG_HOME/aicmd/config.json`). The dotted names below are also
   accepted there; `config.json` works **only** there.
3. The nearest `package.json` with an `aicmd` key, searched upward from the
   current directory.
4. The nearest `.aicmd.json` / `.aicmdrc.json` / `.aicmdrc`, searched upward.
5. CLI flags.

All keys, with their defaults:

```json
{
  "model": "sonnet",
  "shell": null,
  "interactive": false,
  "interactiveCount": 3,
  "interactiveTemperature": 1,
  "spinner": "material",
  "customPrompt": null,
  "includeContext": true,
  "showExplanation": true,
  "dangerousPatterns": null,
  "extraDangerousPatterns": [],
  "allowApiKey": false
}
```

- `shell: null` resolves to `$SHELL`, then `/bin/sh`. The shell is both told
  to the model (fish gets fish syntax) and used to execute.
- `includeContext` injects platform details (macOS's BSD userland vs. GNU,
  architecture, target shell) so generated flags actually work here.
- `dangerousPatterns` **replaces** the built-in guard list;
  `extraDangerousPatterns` **appends** to whichever list is active. Plain
  strings are fish-style whole-string globs (`"*rm *"`), and the `re:` prefix
  switches to a regular expression (`"re:\\bterraform\\s+destroy\\b"`). Both
  match case-insensitively.
- `spinner` is any [cli-spinners](https://github.com/sindresorhus/cli-spinners)
  name, rendered by [ora](https://github.com/sindresorhus/ora). Unknown names
  fall back to `material`.

## Limits worth knowing

- The command runs in a **child** of your shell: `cd`, exports and other
  shell state cannot propagate back to your prompt.
- The model gets **no tools** — it writes a command from knowledge and the
  context block; it cannot probe `man` pages or your filesystem, and it
  cannot execute anything during generation.
- Guard patterns are a net, not a proof. Read the command before you confirm
  it; that is the whole point of the confirmation.

## Development

```sh
bun test           # run the test suite
bun run typecheck  # tsc --noEmit
bun run build      # bundle dist/aicmd.js for plain-Node installs
```

The architecture follows the patterns of
[claude-commit](https://github.com/synmux/claude-commit); see the design spec
in `docs/superpowers/specs/`.
