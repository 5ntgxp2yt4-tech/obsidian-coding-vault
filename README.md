# Coding Vault

An [Obsidian](https://obsidian.md) plugin that turns your vault into a searchable code snippet database, with optional AI-powered metadata generation via [LM Studio](https://lmstudio.ai).

## Features

- **Store Selection as Snippet** — select any code in the editor, run the command, and it's saved as a structured note with YAML frontmatter (title, language, tags, purpose, functions).
- **Store Current File as Snippet** — store the entire open file in one command.
- **Query Snippets** — fuzzy-search your entire snippet database by title, language, or purpose.
- **Fast mode** *(default)* — derives title and tags from code structure instantly, no LLM required.
- **LLM mode** — calls your local LM Studio manager model to generate rich metadata automatically.
- **Compatible with [obsidian-coding-pipeline](https://github.com/5ntgxp2yt4-tech/obsidian-coding-pipeline)** — shares the same frontmatter schema.

## Installation

### From Community Plugins *(once approved)*

1. Open Obsidian → Settings → Community Plugins → Browse
2. Search for **Coding Vault**
3. Install and enable

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/5ntgxp2yt4-tech/obsidian-coding-vault/releases/latest).
2. Copy them into `<your-vault>/.obsidian/plugins/coding-vault/`
3. Reload Obsidian and enable the plugin.

### BRAT (Beta Reviewers Auto-update Tester)

Add `5ntgxp2yt4-tech/obsidian-coding-vault` in the BRAT plugin settings.

## Configuration

Open **Settings → Coding Vault**:

| Setting | Default | Description |
|---|---|---|
| LM Studio URL | `http://127.0.0.1:1234/v1/chat/completions` | Chat completions endpoint |
| Manager model | `obsidian-manager` | Model loaded in LM Studio for metadata generation |
| Database directory | `Copilot/Coding Database` | Vault folder where snippets are stored |
| Fast mode | On | Skip LLM calls; derive metadata from code structure |

## Usage

### Storing a snippet

1. Select code in any editor pane (or use **Store current file**).
2. Open the Command Palette (`Ctrl/Cmd+P`) → **Coding Vault: Store selection as snippet**.
3. Enter a brief description (used as the title in fast mode).
4. Click **Store** — the snippet is saved and opened.

### Querying snippets

1. Command Palette → **Coding Vault: Query snippets**.
2. Type to filter by title, language, or purpose.
3. Select a result to open the note.

## Snippet format

Each snippet is saved as a Markdown note with YAML frontmatter:

```markdown
---
title: "Reverse Linked List in Python"
language: python
purpose: "Iterative linked list reversal"
summary: "Reverses a singly linked list in O(n) time and O(1) space."
tags:
  - python
  - algorithm
functions:
  - reverse_linked_list
platforms: []
frameworks:
  - python
source_model: "manual"
created: "2026-05-02T06:00:00.000Z"
---

## Reverse Linked List in Python

\`\`\`python
def reverse_linked_list(head):
    ...
\`\`\`
```

## Building from source

```bash
git clone https://github.com/5ntgxp2yt4-tech/obsidian-coding-vault
cd obsidian-coding-vault
npm install
npm run build
```

The output `main.js` is placed in the project root.

## License

MIT
