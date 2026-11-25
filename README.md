# Pi Typefully Social Media Extension

Project-local Pi extension for drafting and scheduling LinkedIn + X project posts through the Typefully API.

## What it does

- Adds `/project-post` to start a guided social-post workflow.
- Adds `/social-prefs` to edit your local writing preferences.
- Adds `typefully_account` so Pi can list your Typefully social sets/accounts.
- Adds `typefully_create_social_draft` so Pi can create or schedule approved Typefully drafts.

The extension is intentionally approval-first: Pi should draft and ask for feedback before it uses the Typefully API.

## Setup

1. Create a Typefully API key:

   ```text
   Typefully → Settings → API → Create API key
   ```

2. Export it before starting Pi:

   ```bash
   export TYPEFULLY_API_KEY="your_key_here"
   ```

3. Optional: set a default social set after discovering the right ID:

   ```bash
   export TYPEFULLY_SOCIAL_SET_ID="12345"
   ```

4. Start Pi from this project directory and allow/trust the project extension if prompted.

## Usage

Edit your voice/preferences:

```text
/social-prefs
```

Start a project post workflow:

```text
/project-post launched the new social-media-agent demo --schedule tomorrow 9am
```

Recommended first test:

```text
/project-post test draft only for this project; do not schedule yet
```

Pi should:

1. Inspect the project.
2. Draft LinkedIn and X copy.
3. Ask for your feedback.
4. Wait for approval.
5. Confirm the Typefully social set/account.
6. Create/schedule the Typefully draft.

## Files

- `.pi/extensions/typefully-social.ts` — Pi extension.
- `.pi/social-media/preferences.md` — generated/edited by `/social-prefs`.
- `.env.example` — environment variable template.

## Safety notes

- Do not put your real Typefully API key in committed files.
- The Typefully draft/schedule tool is an external side effect.
- The extension tells Pi not to publish/schedule until approval, but you should still read the tool call before allowing it.
- For X, stay within Typefully/X automation guidance and avoid spammy repeated posts.
