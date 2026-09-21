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
	["r", "/resume"],
	["s", "/tree"],
	["f", "/fork"],
	["c", "/copy"],
	["shift+c", "/clone"],
	["p", "/compact"],
	["shift+e", "/reload"],
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

				if (matchesKey(data, "?")) {
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
								line.replace(/─+/g, (segment) => ctx.ui.theme.fg("info", segment));
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
