I have a fish script which generates me a command based on what I ask it to do using AI via API.

I would like to do the same, but use the Claude Agents SDK. Among the simple fact that it saves API billing, it also means we can use structured output modes to make sure the model doesn’t produce mangled output or have to code super defensively.

It should show the generated command and prompt for permission to run it. Additionally it should show a warning if it generates dangerous commands like (but not limited to) rm .

Use bun as the package manager and opportunistically as the runtime, but if it’s not present, Node is fine. If we can’t do detection, we should target a Node runtime.

I have inclded a copy of claude-commit in the ./claude-commit directory which follows a lot of the same Agents SDK patterns and might be helpful. You should not modify claude-commit, it is a learning and instruction resource only.

The fish script is

```
ai is a function with definition
# Defined in /Users/syn/.config/fish/funcs.fish @ line 515
function ai --description 'AI assistant for generating shell commands'
    argparse x/execute f/force -- $argv
    or return 1

    # Configurable guardrails: patterns to match against potentially dangerous commands
    set -l dangerous_patterns \
        "*rm *" \
        "*chmod -R 777 /*" \
        "*> /dev/sd*" \
        "*dd if=*of=/dev/*" \
        "*mkfs*" \
        "*fdisk*" \
        "*:(){ :|:& };:*" \
        "*curl*|*sh*" \
        "*wget*|*sh*"

    set -l system_prompt "You must output ONLY a single shell command that accomplishes the requested task. Check the --help for the command, and the man page with 'man foo | cat'. NOTABLE PITFALL: BSD vs. GNU versions of tools, which have the same name but different parameters. Adapt your command if necessary. Do not perform the task yourself. Do not output any explanation, markdown formatting, or multiple lines. Output exactly one executable shell command and nothing else."
    set -l ai_output
    set -l prompt

    if test (count $argv) -eq 0
        # No arguments provided, check if gum is available
        if not command -q gum
            echo "❌  Error: gum is not available for interactive prompts."
            echo
            echo "    Install gum from https://github.com/charmbracelet/gum or"
            echo "    invoke this function by specifying the prompt directly:"
            echo
            echo "    ai [PROMPT]"
            echo
            return 1
        end

        set prompt (gum write --header "Enter your prompt" --placeholder "Type your prompt here..." --width 80 --height 10)

        # Check if user cancelled (empty prompt)
        if test -z "$prompt"
            echo "❌ Cancelled by user"
            return 1
        end
    else
        # Arguments provided, use them as the prompt
        set prompt "$argv"
    end

    # Escape quotes and special characters in the prompt to prevent command injection
    set prompt (string escape -- $prompt)

    echo "🤖 Generating command..."

    # Try different package managers to run claude code
    if command -q bun
        set ai_output (bun x @anthropic-ai/claude-code --append-system-prompt "$system_prompt" -p "$prompt" 2>/dev/null)
    else if command -q deno
        set ai_output (deno run -A npm:@anthropic-ai/claude-code --append-system-prompt "$system_prompt" -p "$prompt" 2>/dev/null)
    else if command -q pnpm
        set ai_output (pnpm dlx @anthropic-ai/claude-code --append-system-prompt "$system_prompt" -p "$prompt" 2>/dev/null)
    else if command -q yarn
        set ai_output (yarn dlx @anthropic-ai/claude-code --append-system-prompt "$system_prompt" -p "$prompt" 2>/dev/null)
    else if command -q npx
        set ai_output (npx -y @anthropic-ai/claude-code --append-system-prompt "$system_prompt" -p "$prompt" 2>/dev/null)
    else if command -q claude
        set ai_output (claude --append-system-prompt "$system_prompt" -p "$prompt" 2>/dev/null)
    else
        echo "❌  Error: No suitable package manager or claude command found."
        echo "    Please install bun, deno, pnpm, yarn, npm, or claude code directly"
        return 1
    end

    # Check if AI command failed or returned empty output
    if test $status -ne 0
        echo "❌  Error: Failed to communicate with AI service"
        return 1
    end

    if test -z "$ai_output"
        echo "❌  Error: AI service returned no output"
        return 1
    end

    # Remove code blocks, trim whitespace, and get the actual command
    # Handle various markdown formats and clean up output
    set -l command (echo "$ai_output" | sed -E 's/```[a-zA-Z0-9]*//g; s/```//g' | string trim | head -n 1)

    # Validate that we got a non-empty command
    if test -z "$command"
        echo "❌  Error: AI returned empty command after processing"
        echo "Raw output: $ai_output"
        return 1
    end

    # Check for potentially dangerous commands using configurable patterns
    set -l is_dangerous false
    for pattern in $dangerous_patterns
        if string match -q "$pattern" "$command"
            set is_dangerous true
            break
        end
    end

    if set -q _flag_execute
        # Execute mode (-x flag specified)
        if test "$is_dangerous" = true
            if set -q _flag_force
                # Both -x and -f specified: skip guardrails and execute
                echo "⚠️  FORCE MODE: Executing potentially dangerous command without guardrails"
                echo "⚡ Executing: $command"
                eval $command
            else
                # Only -x specified: refuse to execute dangerous command
                echo "❌  SAFETY: Potentially destructive command detected, refusing to auto-execute"
                echo "🤖 Generated command:"
                echo "$command"
                echo ""
                echo "💡 Use --force (-f) with --execute (-x) to bypass safety checks, or run without --execute for confirmation prompt"
                return 1
            end
        else
            # Not dangerous: execute immediately
            echo "⚡ Executing: $command"
            eval $command
        end
    else
        # Interactive mode (no -x flag): show command and ask for confirmation
        echo "🤖 Generated command:"
        echo "$command"

        # Show warning if dangerous (ignoring -f flag in interactive mode)
        if test "$is_dangerous" = true
            echo ""
            echo "⚠️  WARNING: This command appears potentially destructive!"
        end

        echo ""
        read -l -P "Execute this command? [y/N] " confirm
        if test "$confirm" = y -o "$confirm" = Y
            echo "⚡ Executing..."
            eval $command
        else
            echo "❌ Execution cancelled"
        end
    end
end
```

Your work does not need to be limited to the features of the fish script.

This project is called aicmd, npm package @synmux/aicmd.

Follow the same UI patterns as claude-commit - Commander for the central CLI logic, OpenTUI for the visuals, ora/ cli-spinners for any spinners.

It should be thoroughly configurable with the same paths and patterns as claude-commit.
