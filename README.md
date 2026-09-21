# pi-chords

An Emacs-style `Ctrl+X` command prefix for the [Pi coding agent](https://github.com/badlogic/pi-mono).

Press `Ctrl+X`, then a second key. Pi highlights the prompt borders while waiting. Press `Escape` or `Ctrl+X` again to cancel. `Ctrl+X ?` opens a searchable, scrollable reference containing the configured chords and the remaining Alt/default Ctrl shortcuts.

## Install

```bash
# Git repository (recommended)
pi install git:github.com/Alvaroak/pi-chords@v0.1.0

# Local checkout
pi install /absolute/path/to/pi-chords

# npm, once published
pi install npm:@alvaroak/pi-chords@0.1.0
```

Pi packages execute code with the user's permissions. Review extensions before installing them.

## Default chords

| Chord | Action |
|---|---|
| `C-x m` | Model picker |
| `C-x M` | Scoped models |
| `C-x t` | Thinking level |
| `C-x o` | Toggle tool output |
| `C-x z` | Toggle thinking output |
| `C-x n` | New session |
| `C-x r` | Reload extensions and resources |
| `C-x E` | Resume session |
| `C-x s` | Session tree |
| `C-x f` | Fork session |
| `C-x c` | Copy last assistant message |
| `C-x C` | Clone session |
| `C-x p` | Compact context |
| `C-x u` | Usage overlay, when installed |
| `C-x k` | Keybindings overlay, when installed |
| `C-x g` | Skill groups, when installed |
| `C-x h` | Handoff, when installed |
| `C-x b` | Bash mode, when installed |
| `C-x d` | Repository picker, when installed |
| `C-x D` | Prefill `/cd ` |
| `C-x e` | Export session |
| `C-x q` | Quit Pi |
| `C-x ?` | Searchable shortcut reference |

Optional extension commands are checked at runtime. Missing commands are marked `[not installed]` and are never sent to the model.

## Customize command chords

Create `~/.pi/agent/pi-chords.json`:

```json
{
  "commands": {
    "x": "/my-command",
    "m": "/another-model-command",
    "q": null
  }
}
```

- A string adds or replaces a chord. It must start with `/`.
- `null` removes a default chord.
- Use an uppercase key for a shifted second key, such as `"M"` for `C-x M`.
- `C-x ?`, `C-x o`, `C-x z`, and `C-x D` are reserved by the extension.
- Run `/reload` after changing the file.

## Local development

```bash
pi -e /path/to/pi-chords
```

For a persistent local install:

```bash
pi install /path/to/pi-chords
```

Use `/chords-status` to verify that the native Ctrl+X shortcut is registered.
