/**
 * pi-chords — Ctrl+X command prefix.
 *
 * This intentionally uses ctx.ui.onTerminalInput(), not a CustomEditor:
 * input listeners run before pi routes a key to the transcript, selector, or
 * currently focused editor component. Ctrl+X therefore has one reliable entry
 * point across normal and fullscreen TUI modes.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

const PREFIX = "\x18"; // Ctrl+X
const ESC = "\x1b";
const STATUS_KEY = "pi-chords";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		let pending = false;

		ctx.ui.onTerminalInput((data) => {
			if (!pending) {
				if (data !== PREFIX) return;
				pending = true;
				ctx.ui.setStatus(STATUS_KEY, "C-x- waiting for key");
				return { consume: true };
			}

			pending = false;
			ctx.ui.setStatus(STATUS_KEY, undefined);

			// Esc or a repeated prefix cancels. Never leak either keystroke to pi.
			if (data === ESC || data === PREFIX) return { consume: true };

			const command = CHORDS[data];
			if (command) {
				// A multi-character terminal event is paste, not typing. Set the
				// command through the editor API, then pass a *single* raw Enter key
				// through pi's ordinary interactive dispatcher for built-ins (/model).
				ctx.ui.setEditorText(command);
				return { data: "\r" };
			}

			if (data === "?") {
				void showPalette(ctx, pi);
				return { consume: true };
			}

			// An unknown printable chord opens the command palette. Controls retain
			// their ordinary behavior after cancelling the prefix.
			if (data.length === 1 && data.charCodeAt(0) >= 32) {
				void showPalette(ctx, pi, data);
				return { consume: true };
			}
			return;
		});
	});
}

async function showPalette(ctx: any, pi: ExtensionAPI, hint = ""): Promise<void> {
	const commands = pi.getCommands().filter((command) => !hint || command.name.startsWith(hint));
	const options = commands.map((command) => `/${command.name} - ${command.description ?? ""}`);
	if (options.length === 0) {
		ctx.ui.notify(`No command starts with "${hint}"`, "warning");
		return;
	}
	const selected = await ctx.ui.select(hint ? `C-x → /${hint}*` : "C-x → command palette", options);
	if (!selected) return;
	// The selected text is placed in the editor instead of sent as an extension
	// message: pressing Enter uses pi's interactive dispatcher for built-ins.
	ctx.ui.setEditorText(selected.split(" - ")[0]);
	ctx.ui.notify("Command loaded — press Enter to run it", "info");
}
