/**
 * pi-chords — Ctrl+X command prefix.
 *
 * Ctrl+X uses pi.registerShortcut(), the same native shortcut dispatcher that
 * previously handled app.message.copy. Only the second key uses a temporary
 * terminal-input listener.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CustomEditor, DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	fuzzyFilter,
	Input,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Focusable,
	type KeyId,
} from "@earendil-works/pi-tui";

const DEFAULT_COMMAND_CHORDS: Array<[KeyId, string]> = [
	["m", "/model"],
	[",", "/model-default"],
	["shift+m", "/scoped-models"],
	["t", "/thinking"],
	["n", "/new"],
	["r", "/reload"],
	["s", "/tree"],
	["f", "/fork"],
	["c", "/copy"],
	["shift+c", "/clone"],
	["p", "/compact"],
	["shift+p", "/ponytail"],
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

// o/z are app display actions rather than slash commands. Invoke the editor's
// registered action handlers directly so this package does not depend on any
// user's Alt or Ctrl bindings.
const ACTION_CHORDS: Array<[KeyId, string]> = [
	["o", "app.tools.expand"],
	["z", "app.thinking.toggle"],
];

const BUILTIN_COMMANDS = new Set([
	"model",
	"scoped-models",
	"thinking",
	"new",
	"reload",
	"resume",
	"tree",
	"fork",
	"copy",
	"clone",
	"compact",
	"export",
	"quit",
]);

// Commands requiring arguments are prefilled rather than submitted.
const PREFILL_CHORDS: Array<[KeyId, string]> = [["shift+d", "/cd "]];

const CHORD_HELP: Array<{ key: string; label: string; command?: string }> = [
	{ key: "m", label: "Model picker", command: "/model" },
	{ key: ",", label: "Set default model", command: "/model-default" },
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
	{ key: "P", label: "Ponytail mode picker", command: "/ponytail" },
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

const STATUS_KEY = "pi-chords";

export default function (pi: ExtensionAPI) {
	const { commandChords, configError } = loadCommandChords();
	let waiting = false;
	let cancelWait: (() => void) | undefined;
	let activeEditor: any;

	pi.registerShortcut("ctrl+x", {
		description: "Start Ctrl+X command chord",
		handler: async (ctx) => {
			if (waiting) {
				cancelWait?.();
				return;
			}

			const savedPrompt = ctx.ui.getEditorText();
			waiting = true;
			ctx.ui.setStatus(STATUS_KEY, "C-x- waiting for key");

			const unsubscribe = ctx.ui.onTerminalInput((data) => {
				finish();

				if (matchesKey(data, "escape") || matchesKey(data, "ctrl+x")) {
					return { consume: true };
				}

				const command = commandChords.find(([key]) => matchesKey(data, key))?.[1];
				if (command) {
					if (!isCommandAvailable(pi, command)) {
						ctx.ui.notify(`${command} is not installed`, "warning");
						return { consume: true };
					}
					ctx.ui.setEditorText(command);
					restorePrompt(ctx, savedPrompt);
					return { data: "\r" };
				}

				const action = ACTION_CHORDS.find(([key]) => matchesKey(data, key))?.[1];
				if (action) {
					const handler = activeEditor?.actionHandlers?.get(action);
					if (typeof handler === "function") handler();
					else ctx.ui.notify(`${action} is unavailable in this editor`, "warning");
					return { consume: true };
				}

				const prefill = PREFILL_CHORDS.find(([key]) => matchesKey(data, key))?.[1];
				if (prefill) {
					ctx.ui.setEditorText(prefill);
					return { consume: true };
				}

				if (matchesKey(data, "?")) {
					void showChordHelp(ctx, pi, commandChords);
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
				configError
					? `pi-chords: active with config warning: ${configError}`
					: waiting
						? "pi-chords: Ctrl+X shortcut fired; waiting for the second key."
						: "pi-chords: native Ctrl+X shortcut is registered and idle.",
				configError ? "warning" : "info",
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
			activeEditor = editor;
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

function restorePrompt(ctx: any, prompt: string): void {
	// Let the synthetic Enter run and clear its command before restoring the draft.
	setTimeout(() => ctx.ui.setEditorText(prompt), 0);
}

function loadCommandChords(): { commandChords: Array<[KeyId, string]>; configError?: string } {
	const byKey = new Map<string, string>(DEFAULT_COMMAND_CHORDS);
	const path = join(homedir(), ".pi", "agent", "pi-chords.json");
	if (!existsSync(path)) return { commandChords: [...byKey] as Array<[KeyId, string]> };

	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { commands?: Record<string, unknown> };
		for (const [displayKey, value] of Object.entries(parsed.commands ?? {})) {
			if (["?", "o", "z", "D"].includes(displayKey)) {
				throw new Error(`key "${displayKey}" is reserved by pi-chords`);
			}
			const key = toKeyId(displayKey);
			if (!key) throw new Error(`invalid key "${displayKey}"`);
			if (value === null) byKey.delete(key);
			else if (typeof value === "string" && value.startsWith("/")) byKey.set(key, value);
			else throw new Error(`binding "${displayKey}" must be a slash command or null`);
		}
		return { commandChords: [...byKey] as Array<[KeyId, string]> };
	} catch (error) {
		return {
			commandChords: [...byKey] as Array<[KeyId, string]>,
			configError: error instanceof Error ? error.message : String(error),
		};
	}
}

function toKeyId(key: string): KeyId | undefined {
	if (/^[a-z0-9]$/.test(key)) return key as KeyId;
	if (/^[A-Z]$/.test(key)) return `shift+${key.toLowerCase()}` as KeyId;
	if (key === ",") return key as KeyId;
	return undefined;
}

function displayKey(key: KeyId): string {
	return key.startsWith("shift+") && key.length === 7 ? key.slice(-1).toUpperCase() : key;
}

function isCommandAvailable(pi: ExtensionAPI, command: string): boolean {
	const name = command.slice(1).split(/\s/, 1)[0]!;
	return BUILTIN_COMMANDS.has(name) || pi.getCommands().some((candidate) => candidate.name === name);
}

type HelpItem = { primary: string; label: string; command?: string; unavailable?: boolean };
type HelpPage = { title: string; items: HelpItem[]; empty: string };

function buildPages(pi: ExtensionAPI, commandChords: Array<[KeyId, string]>): HelpPage[] {
	const configured = new Map(commandChords.map(([key, command]) => [displayKey(key), command]));
	const chordHelp = CHORD_HELP.filter(
		(entry) => !entry.command || configured.get(entry.key) === entry.command,
	);
	for (const [key, command] of configured) {
		if (!chordHelp.some((entry) => entry.key === key)) {
			chordHelp.push({ key, label: "Custom command", command });
		}
	}
	const chordItems: HelpItem[] = chordHelp.map((entry) => ({
		primary: `C-x ${entry.key}`,
		label: entry.label,
		command: entry.command,
		unavailable: entry.command ? !isCommandAvailable(pi, entry.command) : false,
	}));

	const altItems: HelpItem[] = ALT_HELP.map(([primary, label]) => ({ primary, label }));

	const commandMap = new Map<string, HelpItem>();
	for (const name of BUILTIN_COMMANDS) {
		commandMap.set(name, { primary: `/${name}`, label: "", command: `/${name}` });
	}
	for (const command of pi.getCommands()) {
		commandMap.set(command.name, {
			primary: `/${command.name}`,
			label: command.description ?? "",
			command: `/${command.name}`,
		});
	}
	const commandItems: HelpItem[] = [...commandMap.values()].sort((a, b) =>
		a.primary.localeCompare(b.primary),
	);

	return [
		{ title: "Ctrl+X", items: chordItems, empty: "No chords match" },
		{ title: "Alt+", items: altItems, empty: "No shortcuts match" },
		{ title: "Pi commands", items: commandItems, empty: "No commands match" },
	];
}

function searchText(item: HelpItem): string {
	return `${item.primary} ${item.label} ${item.command ?? ""}`;
}

// Centered overlay with three tab pages (Ctrl+X / Alt+ / Pi commands), Tab and
// Shift+Tab to switch pages, a fuzzy search bar, and Enter to load the selected
// command into the editor.
class ChordHelpOverlay implements Focusable {
	private pageIndex = 0;
	private selected = 0;
	private scroll = 0;
	private filtered: HelpItem[] = [];
	private readonly search = new Input({ placeholder: "search…" });
	private readonly maxVisible = 10;
	private _focused = false;
	private readonly pages: HelpPage[];
	private readonly theme: any;
	private readonly onPick: (command: string) => void;
	private readonly onClose: () => void;

	constructor(
		pages: HelpPage[],
		theme: any,
		onPick: (command: string) => void,
		onClose: () => void,
	) {
		this.pages = pages;
		this.theme = theme;
		this.onPick = onPick;
		this.onClose = onClose;
		this.applyFilter();
	}

	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.search.focused = value;
	}

	private applyFilter(): void {
		const query = this.search.getValue().trim();
		const items = this.pages[this.pageIndex]!.items;
		this.filtered = query ? fuzzyFilter(items, query, searchText) : items;
		if (this.selected >= this.filtered.length) this.selected = Math.max(0, this.filtered.length - 1);
		this.clampScroll();
	}

	private clampScroll(): void {
		if (this.selected < this.scroll) this.scroll = this.selected;
		else if (this.selected >= this.scroll + this.maxVisible)
			this.scroll = this.selected - this.maxVisible + 1;
	}

	private switchPage(delta: number): void {
		this.pageIndex = (this.pageIndex + delta + this.pages.length) % this.pages.length;
		this.selected = 0;
		this.scroll = 0;
		this.search.setValue("");
		this.applyFilter();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) return this.onClose();
		if (matchesKey(data, "tab")) return this.switchPage(1);
		if (matchesKey(data, "shift+tab")) return this.switchPage(-1);
		if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) {
			if (this.selected > 0) this.selected--;
			return this.clampScroll();
		}
		if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
			if (this.selected < this.filtered.length - 1) this.selected++;
			return this.clampScroll();
		}
		if (matchesKey(data, "enter")) return this.choose();
		// Everything else edits the search field, then re-filters.
		this.search.handleInput(data);
		this.applyFilter();
	}

	private choose(): void {
		const item = this.filtered[this.selected];
		if (item?.command && !item.unavailable) this.onPick(item.command);
	}

	invalidate(): void {
		this.search.invalidate();
	}

	render(width: number): string[] {
		const t = this.theme;
		const pad = (s: string) => truncateToWidth(s, width - 2, "").padEnd(width - 2);
		const tabs = this.pages
			.map((page, i) =>
				i === this.pageIndex
					? t.bg("selectedBg", t.fg("accent", t.bold(` ${page.title} `)))
					: t.fg("muted", ` ${page.title} `),
			)
			.join(t.fg("dim", "│"));
		const lines: string[] = [];
		lines.push(` ${tabs}`);
		lines.push(" " + this.search.render(width - 3)[0]!);
		lines.push(t.fg("dim", "─".repeat(width)));

		if (this.filtered.length === 0) {
			lines.push(" " + t.fg("warning", this.pages[this.pageIndex]!.empty));
		} else {
			const end = Math.min(this.scroll + this.maxVisible, this.filtered.length);
			const primaryWidth = Math.min(
				16,
				Math.max(...this.filtered.slice(this.scroll, end).map((i) => visibleWidth(i.primary))),
			);
			for (let i = this.scroll; i < end; i++) {
				const item = this.filtered[i]!;
				const selected = i === this.selected;
				const primary = item.primary.padEnd(primaryWidth);
				const tail = item.unavailable ? "  [not installed]" : "";
				const rowText = pad(`${selected ? "▸ " : "  "}${primary}  ${item.label}${tail}`);
				if (selected) lines.push(" " + t.bg("selectedBg", t.fg("accent", rowText)));
				else {
					const tone = item.command && !item.unavailable ? "text" : "muted";
					lines.push(" " + t.fg(tone, rowText));
				}
			}
			if (this.filtered.length > this.maxVisible) {
				lines.push(" " + t.fg("dim", `${this.selected + 1}/${this.filtered.length}`));
			}
		}
		lines.push(t.fg("dim", "─".repeat(width)));
		lines.push(" " + t.fg("dim", "tab/shift-tab pages • ↑↓ select • enter load • esc close"));
		return lines.map((line) => truncateToWidth(line, width));
	}
}

async function showChordHelp(
	ctx: any,
	pi: ExtensionAPI,
	commandChords: Array<[KeyId, string]>,
): Promise<void> {
	const pages = buildPages(pi, commandChords);
	const command = await ctx.ui.custom(
		(tui: any, theme: any, _kb: any, done: (value: string | null) => void) => {
			const top = new DynamicBorder((s: string) => theme.fg("accent", s));
			const bottom = new DynamicBorder((s: string) => theme.fg("accent", s));
			const overlay = new ChordHelpOverlay(
				pages,
				theme,
				(picked) => done(picked),
				() => done(null),
			);
			return {
				get focused() {
					return overlay.focused;
				},
				set focused(value: boolean) {
					overlay.focused = value;
				},
				render: (w: number) => [...top.render(w), ...overlay.render(w), ...bottom.render(w)],
				invalidate: () => {
					top.invalidate();
					bottom.invalidate();
					overlay.invalidate();
				},
				handleInput: (data: string) => {
					overlay.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: "70%", minWidth: 54, maxHeight: "85%" } },
	);
	if (!command) return;
	if (!isCommandAvailable(pi, command)) {
		ctx.ui.notify(`${command} is not installed`, "warning");
		return;
	}
	ctx.ui.setEditorText(command);
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
