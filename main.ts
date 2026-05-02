import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  SuggestModal,
  TFile,
  requestUrl,
} from "obsidian";

// ── Types ───────────────────────────────────────────────────────────────────────

interface SnippetMeta {
  title: string;
  purpose: string;
  summary: string;
  tags: string[];
  functions: string[];
  platforms: string[];
  frameworks: string[];
}

interface CodingVaultSettings {
  lmstudioUrl: string;
  managerModel: string;
  dbDir: string;
  fastMode: boolean;
}

interface SnippetResult {
  file: TFile;
  title: string;
  language: string;
  purpose: string;
}

// ── Defaults ────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: CodingVaultSettings = {
  lmstudioUrl: "http://127.0.0.1:1234/v1/chat/completions",
  managerModel: "obsidian-manager",
  dbDir: "Copilot/Coding Database",
  fastMode: true,
};

// ── Language map ────────────────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  swift: "swift",
  py: "python",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  kt: "kotlin",
  java: "java",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  sh: "bash",
  bash: "bash",
  sql: "sql",
  css: "css",
  scss: "css",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  html: "html",
  dockerfile: "dockerfile",
};

// ── Helpers ─────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function isoNow(): string {
  return new Date().toISOString();
}

function quoteYaml(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlList(items: string[]): string {
  if (!items.length) return "[]";
  return "\n" + items.map((i) => `  - ${i}`).join("\n");
}

function detectLang(editor: Editor, file: TFile | null): string {
  // Walk upward from cursor to find the opening code fence language tag
  const cursor = editor.getCursor();
  const lines = editor.getValue().split("\n");
  for (let i = cursor.line; i >= 0; i--) {
    const m = lines[i].match(/^```([a-zA-Z0-9_+#-]+)/);
    if (m) return m[1].toLowerCase();
    // Stop if we hit a bare closing fence above us
    if (i < cursor.line && lines[i].trim() === "```") break;
  }
  if (file) {
    const ext = file.extension.toLowerCase();
    if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext];
  }
  return "text";
}

function buildNoteContent(
  meta: SnippetMeta,
  code: string,
  language: string,
  sourceModel: string
): string {
  const fm = [
    "---",
    `title: ${quoteYaml(meta.title)}`,
    `language: ${language}`,
    `purpose: ${quoteYaml(meta.purpose)}`,
    `summary: ${quoteYaml(meta.summary)}`,
    `tags:${yamlList(meta.tags)}`,
    `functions:${yamlList(meta.functions)}`,
    `platforms:${yamlList(meta.platforms)}`,
    `frameworks:${yamlList(meta.frameworks)}`,
    `source_model: ${quoteYaml(sourceModel)}`,
    `created: "${isoNow()}"`,
    "---",
  ].join("\n");

  return `${fm}\n\n## ${meta.title}\n\n\`\`\`${language}\n${code}\n\`\`\`\n`;
}

// ── Fast metadata (no LLM) ──────────────────────────────────────────────────────

function fastMeta(code: string, language: string, hint: string): SnippetMeta {
  const funcPattern =
    /(?:def |function |func |fn |class |struct |enum |interface )\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  const functions = [
    ...new Set([...code.matchAll(funcPattern)].map((m) => m[1])),
  ].slice(0, 8);

  const title = hint
    ? hint.slice(0, 80)
    : functions[0]
    ? functions[0].replace(/([A-Z])/g, " $1").trim()
    : `${language} snippet`;

  return {
    title,
    purpose: hint || `${language} code snippet`,
    summary: "",
    tags: [language, "snippet"],
    functions,
    platforms: [],
    frameworks: language !== "text" ? [language] : [],
  };
}

// ── LLM metadata via manager model ─────────────────────────────────────────────

async function llmMeta(
  url: string,
  model: string,
  code: string,
  language: string,
  hint: string
): Promise<SnippetMeta | null> {
  const prompt =
    `You are a code metadata extractor. Given a code snippet, return ONLY a valid JSON object with these fields:\n` +
    `- title: string (concise descriptive title, max 80 chars)\n` +
    `- purpose: string (one sentence describing what the code does)\n` +
    `- summary: string (2-3 sentences max)\n` +
    `- tags: string[] (3-6 lowercase tags)\n` +
    `- functions: string[] (function/method/class names defined in the snippet)\n` +
    `- platforms: string[] (e.g. iOS, macOS, cross-platform, web — or empty)\n` +
    `- frameworks: string[] (e.g. SwiftUI, React, Django — or empty)\n\n` +
    `Language: ${language}\n` +
    `Context: ${hint || "none"}\n\n` +
    `Code:\n\`\`\`${language}\n${code.slice(0, 3000)}\n\`\`\`\n\n` +
    `Return only the JSON object, no markdown fences, no explanation.`;

  try {
    const resp = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 512,
      }),
    });

    const text: string =
      resp.json?.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      purpose: typeof parsed.purpose === "string" ? parsed.purpose : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      functions: Array.isArray(parsed.functions) ? parsed.functions : [],
      platforms: Array.isArray(parsed.platforms) ? parsed.platforms : [],
      frameworks: Array.isArray(parsed.frameworks) ? parsed.frameworks : [],
    };
  } catch {
    return null;
  }
}

// ── Store Snippet Modal ─────────────────────────────────────────────────────────

class StoreSnippetModal extends Modal {
  private code: string;
  private language: string;
  private settings: CodingVaultSettings;
  private onSubmit: (hint: string, language: string) => void;

  constructor(
    app: App,
    code: string,
    language: string,
    settings: CodingVaultSettings,
    onSubmit: (hint: string, language: string) => void
  ) {
    super(app);
    this.code = code;
    this.language = language;
    this.settings = settings;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("coding-vault-store-modal");
    contentEl.createEl("h2", { text: "Store Code Snippet" });

    let hint = "";
    let lang = this.language;

    new Setting(contentEl)
      .setName("Language")
      .setDesc("Auto-detected — edit if wrong.")
      .addText((t) =>
        t.setValue(lang).onChange((v) => {
          lang = v.trim() || "text";
        })
      );

    new Setting(contentEl)
      .setName("Description / hint")
      .setDesc(
        this.settings.fastMode
          ? "Used directly as the snippet title."
          : "Optional context sent to the manager model."
      )
      .addText((t) => {
        t.setPlaceholder("e.g. SwiftUI navigation stack helper").onChange(
          (v) => {
            hint = v;
          }
        );
        t.inputEl.style.width = "100%";
      });

    const modeNote = this.settings.fastMode
      ? "Fast mode — title derived from description (no LLM call)."
      : `LLM mode — ${this.settings.managerModel} will generate metadata.`;

    contentEl.createEl("p", {
      text: modeNote,
      cls: "coding-vault-meta-notice",
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Store")
          .setCta()
          .onClick(() => {
            this.close();
            this.onSubmit(hint.trim(), lang);
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => this.close())
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Query Modal ─────────────────────────────────────────────────────────────────

class QueryModal extends SuggestModal<SnippetResult> {
  private results: SnippetResult[];

  constructor(app: App, results: SnippetResult[]) {
    super(app);
    this.results = results;
    this.setPlaceholder("Search by title, language, or purpose…");
  }

  getSuggestions(query: string): SnippetResult[] {
    const q = query.toLowerCase();
    if (!q) return this.results.slice(0, 50);
    return this.results
      .filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.language.toLowerCase().includes(q) ||
          r.purpose.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }

  renderSuggestion(item: SnippetResult, el: HTMLElement) {
    el.createEl("div", { text: item.title, cls: "suggestion-title" });
    el.createEl("small", {
      text: `${item.language}${item.purpose ? " — " + item.purpose : ""}`,
      cls: "suggestion-note",
    });
  }

  onChooseSuggestion(item: SnippetResult) {
    this.app.workspace.getLeaf(false).openFile(item.file);
  }
}

// ── Settings Tab ────────────────────────────────────────────────────────────────

class CodingVaultSettingTab extends PluginSettingTab {
  private plugin: CodingVaultPlugin;

  constructor(app: App, plugin: CodingVaultPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Coding Vault" });

    new Setting(containerEl)
      .setName("LM Studio URL")
      .setDesc(
        "Chat completions endpoint for your local LM Studio instance."
      )
      .addText((t) =>
        t
          .setPlaceholder("http://127.0.0.1:1234/v1/chat/completions")
          .setValue(this.plugin.settings.lmstudioUrl)
          .onChange(async (v) => {
            this.plugin.settings.lmstudioUrl = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Manager model")
      .setDesc(
        "Model identifier in LM Studio used for metadata generation."
      )
      .addText((t) =>
        t
          .setPlaceholder("obsidian-manager")
          .setValue(this.plugin.settings.managerModel)
          .onChange(async (v) => {
            this.plugin.settings.managerModel = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Database directory")
      .setDesc(
        "Vault-relative path where snippets are stored (e.g. Copilot/Coding Database)."
      )
      .addText((t) =>
        t
          .setPlaceholder("Copilot/Coding Database")
          .setValue(this.plugin.settings.dbDir)
          .onChange(async (v) => {
            this.plugin.settings.dbDir = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Fast mode")
      .setDesc(
        "Derive title and tags from code structure without calling the manager model. " +
          "Much faster; disable for richer AI-generated metadata."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.fastMode).onChange(async (v) => {
          this.plugin.settings.fastMode = v;
          await this.plugin.saveSettings();
        })
      );

    // Snippet count stat
    const dbDir = this.plugin.settings.dbDir;
    const count = this.plugin.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(dbDir + "/")).length;

    new Setting(containerEl)
      .setName("Snippets in vault")
      .setDesc(`${count} notes found in "${dbDir}".`);
  }
}

// ── Main Plugin ─────────────────────────────────────────────────────────────────

export default class CodingVaultPlugin extends Plugin {
  settings: CodingVaultSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    // ── Command: store selection ─────────────────────────────────────────────
    this.addCommand({
      id: "store-selection",
      name: "Store selection as snippet",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection().trim();
        if (!selection) {
          new Notice("No text selected — select some code first.");
          return;
        }
        const lang = detectLang(editor, view.file);
        new StoreSnippetModal(
          this.app,
          selection,
          lang,
          this.settings,
          (hint, resolvedLang) =>
            this.storeSnippet(selection, resolvedLang, hint)
        ).open();
      },
    });

    // ── Command: store current file ──────────────────────────────────────────
    this.addCommand({
      id: "store-file",
      name: "Store current file as snippet",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        if (!view.file) {
          new Notice("No file is open.");
          return;
        }
        const code = editor.getValue().trim();
        if (!code) {
          new Notice("File is empty.");
          return;
        }
        const lang = EXT_TO_LANG[view.file.extension.toLowerCase()] ?? "text";
        new StoreSnippetModal(
          this.app,
          code,
          lang,
          this.settings,
          (hint, resolvedLang) =>
            this.storeSnippet(code, resolvedLang, hint)
        ).open();
      },
    });

    // ── Command: query ───────────────────────────────────────────────────────
    this.addCommand({
      id: "query",
      name: "Query snippets",
      callback: () => this.openQueryModal(),
    });

    this.addSettingTab(new CodingVaultSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── Core store ──────────────────────────────────────────────────────────────

  async storeSnippet(
    code: string,
    language: string,
    hint: string
  ): Promise<void> {
    let meta: SnippetMeta | null = null;

    if (!this.settings.fastMode) {
      new Notice("Generating metadata…", 3000);
      meta = await llmMeta(
        this.settings.lmstudioUrl,
        this.settings.managerModel,
        code,
        language,
        hint
      );
      if (!meta) {
        new Notice(
          "Manager model unavailable — falling back to fast mode.",
          4000
        );
      }
    }

    if (!meta) {
      meta = fastMeta(code, language, hint);
    }

    if (!meta.title) {
      new Notice("Could not determine a title. Add a description and try again.");
      return;
    }

    const filename = `${slugify(meta.title)}-${nowStamp()}.md`;
    const dirPath = `${this.settings.dbDir}/${language}`;
    const filePath = `${dirPath}/${filename}`;
    const content = buildNoteContent(meta, code, language, "manual");

    // Ensure the language subdirectory exists
    if (!this.app.vault.getAbstractFileByPath(dirPath)) {
      await this.app.vault.createFolder(dirPath);
    }

    await this.app.vault.create(filePath, content);
    new Notice(`Stored: ${meta.title}`);

    const newFile = this.app.vault.getAbstractFileByPath(filePath);
    if (newFile instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(newFile);
    }
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  async openQueryModal(): Promise<void> {
    const results = this.loadSnippetIndex();
    if (!results.length) {
      new Notice(
        `No snippets found in "${this.settings.dbDir}". Store some first.`
      );
      return;
    }
    new QueryModal(this.app, results).open();
  }

  loadSnippetIndex(): SnippetResult[] {
    const prefix = this.settings.dbDir + "/";
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix))
      .map((file) => {
        const fm =
          this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        return {
          file,
          title: fm.title ?? file.basename,
          language: fm.language ?? "unknown",
          purpose: fm.purpose ?? "",
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }
}
