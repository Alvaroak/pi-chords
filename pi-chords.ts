/**
 * pi-chords — Ctrl+X command prefix.
 *
 * Ctrl+X uses pi.registerShortcut(), the same native shortcut dispatcher that
 * previously handled app.message.copy. Only the second key uses a temporary
 * terminal-input listener.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

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

const STATUS_KEY = "pi-chords";

export default function (pi: ExtensionAPI) {
	let waiting = false;
	let cancelWait: (() => void) | undefined;

	pi.registerShortcut("ctrl+x", {
		description: "Start Ctrl+X command chord",
		handler: async (ctx) => {
			// Repeating Ctrl+X cancels the existing wait.
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

				const command = CHORDS[data];
				if (command) {
					ctx.ui.setEditorText(command);
					// One raw Enter runs through pi's native interactive command path.
					return { data: "\r" };
				}

				if (data === "?") {
					void showPalette(ctx, pi);
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
	ctx.ui.setEditorText(selected.split(" - ")[0]);
	ctx.ui.notify("Command loaded — press Enter to run it", "info");
}
