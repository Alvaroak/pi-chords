/**
 * pi-chords — Ctrl+X command prefix.
 *
 * Ctrl+X uses pi.registerShortcut(), the same native shortcut dispatcher that
 * previously handled app.message.copy. Only the second key uses a temporary
 * terminal-input listener.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, type KeyId } from "@earendil-works/pi-tui";

const COMMAND_CHORDS: Array<[KeyId, string]> = [
	["m", "/model"],
	["shift+m", "/scoped-models"],
	["t", "/thinking"],
	["n", "/new"],
	["r", "/reload"],
	["s", "/tree"],
	["f", "/fork"],
	["c", "/copy"],
	["shift+c", "/clone"],
	["p", "/compact"],
	["shift+e", "/resume"],
	["u", "/usage"],
	["k", "/keys"],
	["g", "/skillgroups"],
	["h", "/handoff"],
	["b", "/bash-mode"],
	["d", "/cdr"],
	["e", "/export"],
	["q", "/quit"],
];

// o/z are app display actions rather than slash commands. Re-emit the existing
// native bindings after consuming the chord's second key.
const ACTION_CHORDS: Array<[KeyId, string]> = [
	["o", "\x1bo"], // app.tools.expand (alt+o)
	["z", "\x1bz"], // app.thinking.toggle (alt+z)
];

// Commands requiring arguments are prefilled rather than submitted.
const PREFILL_CHORDS: Array<[KeyId, string]> = [["shift+d", "/cd "]];

const CHORD_HELP: Array<{ key: string; label: string; command?: string }> = [
	{ key: "m", label: "Model picker", command: "/model" },
	{ key: "M", label: "Scoped models", command: "/scoped-models" },
	{ key: "t", label: "Thinking level", command: "/thinking" },
	{ key: "o", label: "Toggle tool output" },
	{ key: "z", label: "Toggle thinking output" },
	{ key: "n", label: "New session", command: "/new" },
	{ key: "r", label: "Reload extensions and resources", command: "/reload" },
	{ key: "E", label: "Resume session", command: "/resume" },
	{ key: "s", label: "Session tree", command: "/tree" },
	{ key: "f", label: "Fork session", command: "/fork" },
	{ key: "c", label: "Copy last assistant message", command: "/copy" },
	{ key: "C", label: "Clone session", command: "/clone" },
	{ key: "p", label: "Compact context", command: "/compact" },
	{ key: "u", label: "Usage overlay", command: "/usage" },
	{ key: "k", label: "Keybindings overlay", command: "/keys" },
	{ key: "g", label: "Skill groups", command: "/skillgroups" },
	{ key: "h", label: "Handoff session", command: "/handoff" },
	{ key: "b", label: "Toggle bash mode", command: "/bash-mode" },
	{ key: "d", label: "Pick repository", command: "/cdr" },
	{ key: "D", label: "Change directory", command: "/cd " },
	{ key: "e", label: "Export session", command: "/export" },
	{ key: "q", label: "Quit pi", command: "/quit" },
	{ key: "?", label: "Show this searchable chord list" },
];

const ALT_HELP: Array<[string, string]> = [
	["Alt+]", "Next model (your override)"],
	["Alt+[", "Previous model (your override)"],
	["Alt+Z", "Toggle thinking output (used by C-x z)"],
	["Alt+O", "Toggle tool output (used by C-x o)"],
	["Alt+Q", "Queue follow-up message"],
	["Alt+W", "Restore queued message to editor"],
];

const CTRL_HELP: Array<[string, string]> = [
	["Ctrl+A / Ctrl+E", "Move to line start / end"],
	["Ctrl+B / Ctrl+F", "Move cursor left / right"],
	["Ctrl+Left / Ctrl+Right", "Move one word"],
	["Ctrl+Home / Ctrl+End", "Move to editor start / end"],
	["Ctrl+PageUp / Ctrl+PageDown", "Scroll editor by page"],
	["Ctrl+]", "Jump forward to character"],
	["Ctrl+Alt+]", "Jump backward to character"],
	["Ctrl+D", "Delete forward; exit when editor is empty"],
	["Ctrl+W", "Delete previous word"],
	["Ctrl+U / Ctrl+K", "Delete to line start / end"],
	["Ctrl+Y", "Yank most recently deleted text"],
	["Ctrl+-", "Undo"],
	["Ctrl+J", "Insert newline"],
	["Ctrl+C", "Copy selection; clear/exit when none"],
	["Ctrl+G", "Open external editor"],
	["Ctrl+L", "Open model selector"],
	["Ctrl+P", "Next model by default; customized locally"],
	["Ctrl+Shift+P", "Previous model by default; overridden by Alt+["],
	["Ctrl+S", "Save selection/default inside model and thinking pickers"],
	["Ctrl+T", "Toggle thinking by default; overridden by Alt+Z"],
	["Ctrl+O", "Toggle tools by default; overridden by Alt+O"],
	["Ctrl+Q", "Follow-up on WSL by default; overridden by Alt+Q"],
	["Ctrl+V", "Paste clipboard by default; WSL uses Alt+V"],
	["Ctrl+Z", "Suspend by default; disabled locally"],
	["Ctrl+X", "Copy by default; disabled and replaced by this chord prefix"],
	["Ctrl+Up / Ctrl+Down", "Previous / next prompt in fullscreen"],
	["Ctrl+Shift+F", "Search fullscreen transcript"],
];

const STATUS_KEY = "pi-chords";

export default function (pi: ExtensionAPI) {
	let waiting = false;
	let cancelWait: (() => void) | undefined;

	pi.registerShortcut("ctrl+x", {
		description: "Start Ctrl+X command chord",
		handler: async (ctx) => {
			if (waiting) {
				cancelWait?.();
				return;
			}

			waiting = true;
			ctx.ui.setStatus(STATUS_KEY, "C-x- waiting for key");

			const unsubscribe = ctx.ui.onTerminalInput((data) => {
				finish();

				if (matchesKey(data, "escape") || matchesKey(data, "ctrl+x")) {
					return { consume: true };
				}

				const command = COMMAND_CHORDS.find(([key]) => matchesKey(data, key))?.[1];
				if (command) {
					ctx.ui.setEditorText(command);
					return { data: "\r" };
				}

				const actionKey = ACTION_CHORDS.find(([key]) => matchesKey(data, key))?.[1];
				if (actionKey) return { data: actionKey };

				const prefill = PREFILL_CHORDS.find(([key]) => matchesKey(data, key))?.[1];
				if (prefill) {
					ctx.ui.setEditorText(prefill);
					return { consume: true };
				}

				if (matchesKey(data, "?")) {
					void showChordHelp(ctx);
					return { consume: true };
				}

				if (data.length === 1 && data.charCodeAt(0) >= 32) {
					void showPalette(ctx, pi, data);
					return { consume: true };
				}
				return;
			});

			function finish() {
				if (!waiting) return;
				waiting = false;
				ctx.ui.setStatus(STATUS_KEY, undefined);
				unsubscribe();
				cancelWait = undefined;
			}

			cancelWait = finish;
		},
	});

	pi.registerCommand("chords-status", {
		description: "Report Ctrl+X chord shortcut status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				waiting
					? "pi-chords: Ctrl+X shortcut fired; waiting for the second key."
					: "pi-chords: native Ctrl+X shortcut is registered and idle.",
				"info",
			);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		// Preserve the user's centered-slash/custom editor. This proxy changes
		// only rendered border glyphs while a chord is pending and forwards every
		// other property/method to the original editor component.
		const previous = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = previous
				? previous(tui, theme, keybindings)
				: new CustomEditor(tui, theme, keybindings);
			return new Proxy(editor, {
				get(target, property, receiver) {
					if (property === "render") {
						return (width: number) => {
							const lines = target.render(width);
							if (!waiting || lines.length < 2) return lines;
							const blue = (line: string) =>
								line.replace(/─+/g, (segment) => ctx.ui.theme.fg("borderAccent", segment));
							lines[0] = blue(lines[0]!);
							lines[lines.length - 1] = blue(lines[lines.length - 1]!);
							return lines;
						};
					}
					const value = Reflect.get(target, property, receiver);
					return typeof value === "function" ? value.bind(target) : value;
				},
				set(target, property, value) {
					return Reflect.set(target, property, value);
				},
			});
		});
	});
}

async function showChordHelp(ctx: any): Promise<void> {
	const chordRows = new Map(
		CHORD_HELP.map((entry) => [
			`C-x ${entry.key.padEnd(2)}  ${entry.label}${entry.command ? `  ${entry.command}` : ""}`,
			entry,
		]),
	);
	const rows = [
		"── Ctrl+X commands ──",
		...chordRows.keys(),
		"── Remaining Alt shortcuts ──",
		...ALT_HELP.map(([key, label]) => `${key.padEnd(22)}  ${label}`),
		"── Pi default Ctrl shortcuts (context-dependent) ──",
		...CTRL_HELP.map(([key, label]) => `${key.padEnd(28)}  ${label}`),
	];
	const selected = await ctx.ui.select("Keyboard map — type to search", rows);
	if (!selected || selected.startsWith("──")) return;
	const entry = chordRows.get(selected);
	if (!entry?.command) {
		ctx.ui.notify(`${selected.trim()} — reference entry`, "info");
		return;
	}
	ctx.ui.setEditorText(entry.command);
	ctx.ui.notify("Command loaded — press Enter to run it", "info");
}

async function showPalette(ctx: any, pi: ExtensionAPI, hint = ""): Promise<void> {
	const names = [
		...new Set(
			pi
				.getCommands()
				.map((command) => command.name)
				.filter((name) => !hint || name.toLowerCase().startsWith(hint.toLowerCase())),
		),
	];
	const options = names.map((name) => `/${name}`);
	if (options.length === 0) {
		ctx.ui.notify(`No command starts with "${hint}"`, "warning");
		return;
	}
	const selected = await ctx.ui.select(hint ? `C-x → /${hint}*` : "C-x → command", options);
	if (!selected) return;
	ctx.ui.setEditorText(selected);
	ctx.ui.notify("Command loaded — press Enter to run it", "info");
}
