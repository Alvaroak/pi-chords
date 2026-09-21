/**
 * pi-chords — Ctrl+X as a command prefix (Emacs C-x style).
 *
 * Press Ctrl+X, the editor border shows "C-x-", press the second key:
 *   C-x m /model · C-x t /thinking · C-x n /new · C-x r /resume · C-x s /tree
 *   C-x f /fork · C-x c /copy · C-x u /usage · C-x k /keys · C-x g /skillgroups
 *   C-x h /handoff · C-x b /bash-mode · C-x d /cdr · C-x e /export
 *   C-x p /compact · C-x M /scoped-models · C-x C /clone · C-x E /reload
 *   C-x q /quit · C-x ? command palette (all /commands via picker)
 *   C-x <other printable> → same palette filtered on that command name
 *
 * Esc or Ctrl+X again cancels a pending chord. Everything else flows through
 * super.handleInput(), so app keybindings and previously composed custom
 * editors (e.g. centered-slash-menu) keep working.
 *
 * Install: pi loads it via ~/.pi/agent/extensions/pi-chords.ts (symlink into
 * ~/repos/pi/pi-chords/pi-chords.ts).
 */

import { CustomEditor, type ExtensionAPI, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Second key (raw char as it reaches the terminal) -> slash command to run.
// No leading slash, no args. Capitals mean "hold shift on the second key".
const CHORDS: Record<string, string> = {
	m: "/model",
	M: "/scoped-models",
	t: "/thinking",
	n: "/new",
	r: "/resume",
	s: "/tree",
	f: "/fork",
	c: "/copy",
	C: "/clone",
	p: "/compact",
	E: "/reload",
	u: "/usage",
	k: "/keys",
	g: "/skillgroups",
	h: "/handoff",
	b: "/bash-mode",
	d: "/cdr",
	e: "/export",
	q: "/quit",
};

const PENDING_LABEL = " C-x- ";
const ENTER = "\r";

class ChordEditor extends CustomEditor {
	private pending = false;

	private uiNonInteractiveRun: Pick<ExtensionAPI, "sendUserMessage" | "getCommands">;
	private ui: any;

	constructor(tui: any, theme: any, keybindings: any, opts: { base?: unknown } = {}, services: any = {}) {
		// 4th arg opts matches the composed-editor signature: { base: prevFactory(...) }
		super(tui, theme, keybindings, { base: opts.base });
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		this.uiNonInteractiveRun = services.pi;
		this.ui = services.ui;
	}

	handleInput(data: string): void {
		// Pending chord: consume the second key, or hand it back untouched.
		if (this.pending) {
			this.pending = false;
			// Ctrl+X again or Esc cancels without running anything.
			if (data === "\x18" || data === "\x1b") return;
			const cmd = CHORDS[data];
			if (cmd) {
				this.runSlash(cmd);
				return;
			}
			if (data === "?") {
				this.palette();
				return;
			}
			// Wrong printable second key: treat it as the first letter of a
			// command and open the palette pre-filtered on it.
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				this.palette(data);
				return;
			}
			super.handleInput(data);
			return;
		}

		if (data === "\x18") {
			this.pending = true;
			return;
		}
		super.handleInput(data);
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (!this.pending || lines.length === 0) return lines;
		const last = lines.length - 1;
		if (visibleWidth(lines[last]!) >= PENDING_LABEL.length) {
			lines[last] = truncateToWidth(lines[last]!, width - PENDING_LABEL.length, "") + PENDING_LABEL;
		}
		return lines;
	}

	private runSlash(cmd: string): void {
		// Preferred: invoke the app's own submit handler — identical to the user
		// typing the command and pressing Enter, so built-ins (/model, /new, …)
		// resolve exactly as interactive input.
		const submit = (this as any).onSubmit as ((text: string) => void) | undefined;
		if (typeof submit === "function") {
			submit(cmd);
			return;
		}
		// Non-TUI fallback (RPC/JSON modes): command pipeline dispatch.
		this.uiNonInteractiveRun.sendUserMessage(cmd, { expandPromptTemplates: true });
	}

	private async palette(hint = ""): Promise<void> {
		const commands: SlashCommandInfo[] = this.uiNonInteractiveRun.getCommands();
		const filtered = hint ? commands.filter((c) => c.name.startsWith(hint)) : commands;
		const items: string[] = filtered.map((c) => `/${c.name} - ${c.description ?? ""}`);
		if (items.length === 0) {
			this.ui.notify(`No command matches "${hint}"`, "warning");
			return;
		}
		const selected = await this.ui.select(
			hint ? `C-x → /${hint}*` : "C-x → command palette",
			items,
		);
		if (selected && !selected.startsWith("---")) {
			const name = selected.split(" - ")[0];
			this.uiNonInteractiveRun.sendUserMessage(name);
		}
	}
}

const CHORD_FACTORY = "__piChordsBase";

export default function (pi: ExtensionAPI) {
	let installed = false;

	const install = (ctx: any) => {
		if (installed) return;
		installed = true;
		const current = ctx.ui.getEditorComponent?.() as any;
		// A reload may see our previous factory. Unwrap it so we don't stack
		// ChordEditor around ChordEditor on every /reload.
		const previous = current?.[CHORD_FACTORY] ?? current;
		const factory: any = (tui: any, theme: any, kb: any) =>
			new ChordEditor(tui, theme, kb, { base: previous?.(tui, theme, kb) }, { pi, ui: ctx.ui });
		factory[CHORD_FACTORY] = previous;
		ctx.ui.setEditorComponent(factory);
	};

	// session_start is the reliable startup point: centered-slash-menu has
	// already installed its editor and we wrap it afterwards.
	pi.on("session_start", (_event, ctx) => install(ctx));
	// If pi invokes discovery after a reload, update immediately too. The guard
	// makes the ordinary startup sequence a single installation.
	pi.on("resources_discover", (_event, ctx) => install(ctx));
}
