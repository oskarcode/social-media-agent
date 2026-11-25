import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = process.env.TYPEFULLY_API_BASE || "https://api.typefully.com";

interface TypefullyResponse {
	[id: string]: unknown;
}

function getApiKey(): string {
	const key = process.env.TYPEFULLY_API_KEY;
	if (!key) {
		throw new Error(
			"TYPEFULLY_API_KEY is not set. Create one in Typefully → Settings → API, then run: export TYPEFULLY_API_KEY=...",
		);
	}
	return key;
}

async function typefullyRequest(method: string, apiPath: string, body?: unknown): Promise<TypefullyResponse> {
	const res = await fetch(`${API_BASE}${apiPath}`, {
		method,
		headers: {
			Authorization: `Bearer ${getApiKey()}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	const text = await res.text();
	let data: unknown = text;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		// Keep raw text when the response is not JSON.
	}

	if (!res.ok) {
		throw new Error(`Typefully ${method} ${apiPath} failed (${res.status}): ${JSON.stringify(data)}`);
	}

	return data as TypefullyResponse;
}

function projectFile(cwd: string, ...parts: string[]): string {
	return path.join(cwd, ".pi", "social-media", ...parts);
}

async function ensurePreferenceFile(cwd: string): Promise<string> {
	const file = projectFile(cwd, "preferences.md");
	await mkdir(path.dirname(file), { recursive: true });
	try {
		return await readFile(file, "utf8");
	} catch {
		const defaults = `# Social post preferences\n\n## Voice\n- Direct, technical, and practical.\n- First person is OK when describing projects I built.\n- Avoid hype, empty AI phrasing, and long emoji chains.\n\n## LinkedIn\n- Start with the concrete problem or shipped result.\n- Explain the architecture or technical lesson briefly.\n- End with a useful takeaway or invitation to discuss.\n\n## X\n- Prefer one strong post or a short thread.\n- Keep it punchy and specific.\n- Avoid engagement bait.\n\n## Safety\n- Never publish without my explicit approval.\n- If Cloudflare/customer/internal details are present, ask me to confirm they are OK to share.\n`;
		await writeFile(file, defaults, "utf8");
		return defaults;
	}
}

function parseArgs(args: string): { topic: string; scheduleHint: string } {
	const trimmed = args.trim();
	const scheduleMatch = trimmed.match(/(?:--schedule|--time)\s+(.+)$/i);
	return {
		topic: scheduleMatch ? trimmed.slice(0, scheduleMatch.index).trim() : trimmed,
		scheduleHint: scheduleMatch?.[1]?.trim() || "",
	};
}

export default function typefullySocialExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections.typefully_social_media = [
			"When helping with Typefully social posting:",
			"- Treat Typefully publishing/scheduling as an external side effect.",
			"- Draft and ask for feedback before creating a Typefully draft.",
			"- Do not call `typefully_create_social_draft` until the user explicitly approves the final text and target schedule.",
			"- Prefer scheduled/draft creation over immediate publishing; use `publishAt: now` only when the user explicitly asks to publish now.",
			"- Keep LinkedIn and X copy platform-specific rather than identical when helpful.",
		].join("\n");
	});

	pi.registerTool({
		name: "typefully_account",
		label: "Typefully account",
		description: "Read the current Typefully user and available social sets/accounts. Use before creating drafts to choose the right socialSetId.",
		parameters: Type.Object({}),
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		async execute() {
			const [me, socialSets] = await Promise.all([
				typefullyRequest("GET", "/v2/me"),
				typefullyRequest("GET", "/v2/social-sets?limit=50"),
			]);
			return {
				content: [{ type: "text", text: JSON.stringify({ me, socialSets }, null, 2) }],
				details: { me, socialSets },
			};
		},
	});

	pi.registerTool({
		name: "typefully_create_social_draft",
		label: "Create Typefully draft",
		description:
			"Create or schedule a Typefully draft for LinkedIn and/or X. Only use after explicit user approval of text, account/social set, and schedule.",
		parameters: Type.Object({
			socialSetId: Type.Optional(
				Type.Number({
					description:
						"Typefully social set ID. If omitted, TYPEFULLY_SOCIAL_SET_ID from the environment is used.",
				}),
			),
			linkedinText: Type.Optional(Type.String({ description: "Final approved LinkedIn post text." })),
			xPosts: Type.Optional(
				Type.Array(Type.String(), {
					description: "Final approved X post/thread texts. One array item per post in the thread.",
				}),
			),
			publishAt: Type.Optional(
				Type.String({
					description:
						"Optional schedule. Use an ISO datetime, `next-free-slot`, or `now`. Omit to create an unscheduled draft.",
				}),
			),
		}),
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
		async execute(_toolCallId, params) {
			const socialSetId = params.socialSetId ?? Number(process.env.TYPEFULLY_SOCIAL_SET_ID);
			if (!socialSetId || Number.isNaN(socialSetId)) {
				throw new Error(
					"Missing socialSetId. Run the typefully_account tool first or set TYPEFULLY_SOCIAL_SET_ID.",
				);
			}

			const platforms: Record<string, unknown> = {};
			if (params.linkedinText?.trim()) {
				platforms.linkedin = {
					enabled: true,
					posts: [{ text: params.linkedinText.trim() }],
				};
			}
			if (params.xPosts?.length) {
				platforms.x = {
					enabled: true,
					posts: params.xPosts.map((text: string) => ({ text: text.trim() })).filter((post) => post.text),
				};
			}

			if (Object.keys(platforms).length === 0) {
				throw new Error("Provide linkedinText and/or xPosts.");
			}

			const body: Record<string, unknown> = { platforms };
			if (params.publishAt?.trim()) {
				body.publish_at = params.publishAt.trim();
			}

			const draft = await typefullyRequest("POST", `/v2/social-sets/${socialSetId}/drafts`, body);
			return {
				content: [
					{
						type: "text",
						text: `Created Typefully draft${params.publishAt ? ` with publish_at=${params.publishAt}` : ""}:\n${JSON.stringify(draft, null, 2)}`,
					},
				],
				details: { socialSetId, request: body, draft },
			};
		},
	});

	pi.registerCommand("project-post", {
		description: "Draft a LinkedIn + X launch/update post for this project, then create/schedule it in Typefully after approval",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Run /project-post after the current turn finishes.", "warning");
				return;
			}

			const prefs = await ensurePreferenceFile(ctx.cwd);
			const { topic, scheduleHint } = parseArgs(args);
			const request = `Run the Typefully project social-post workflow.\n\nProject/topic hint from me: ${topic || "infer from this repository/project"}\n${scheduleHint ? `Schedule hint from me: ${scheduleHint}\n` : ""}\nMy social-post preferences from .pi/social-media/preferences.md:\n\n${prefs}\n\nWorkflow rules:\n1. Inspect the current project enough to understand what was built or changed.\n2. Draft separate LinkedIn and X copy. X may be a single post or short thread.\n3. Ask me for feedback and wait. Do not create a Typefully draft yet.\n4. After I explicitly approve the final copy and schedule, call typefully_account if needed, confirm the social set/account, then call typefully_create_social_draft.\n5. If the schedule is not explicit, ask for it. Do not use publishAt=now unless I explicitly say to publish now.\n6. Flag anything that may be confidential, customer-specific, or Cloudflare-internal before posting.`;

			pi.sendUserMessage(request);
		},
	});

	pi.registerCommand("social-prefs", {
		description: "Edit the project social-post voice and platform preferences",
		handler: async (_args, ctx) => {
			const current = await ensurePreferenceFile(ctx.cwd);
			const updated = await ctx.ui.editor("Edit social post preferences", current);
			if (updated === undefined) {
				ctx.ui.notify("Social preferences unchanged", "info");
				return;
			}
			const file = projectFile(ctx.cwd, "preferences.md");
			await writeFile(file, updated, "utf8");
			ctx.ui.notify(`Saved ${file}`, "info");
		},
	});
}
