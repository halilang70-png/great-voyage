/**
 * Content renderer — markdown, URL detection, code highlighting.
 * All pure string transforms, no DOM dependency.
 */

// ─── Code detection ───────────────────────────────────────

const CODE_INDICATORS = [
	/^[\s]*[{}\[\]();]/m,           // lines starting with braces/parens
	/\bfunction\b|\bconst\b|\blet\b|\bvar\b|\breturn\b|\bimport\b/,
	/\bclass\b|\binterface\b|\benum\b|\btype\b/,
	/=>\s*[{(]/,                    // arrow functions
	/^\s*(\/\/|#|--|\/\*|\*\/)/m,   // comment styles
	/\bconsole\.\w+\(/,
	/\bif\s*\(|\bfor\s*\(|\bwhile\s*\(/,
	/\bdef\s+\w+|:\s*$/m,          // Python
	/\bfn\s+\w+/,                   // Rust
];

function looksLikeCode(text: string): boolean {
	const lines = text.split('\n');
	if (lines.length < 2) return false;
	let score = 0;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		// High density of special chars
		const specialRatio = (trimmed.replace(/[a-zA-Z0-9_\s]/g, '').length) / Math.max(trimmed.length, 1);
		if (specialRatio > 0.3) score++;
	}
	for (const indicator of CODE_INDICATORS) {
		if (indicator.test(text)) score += 2;
	}
	return score >= 3;
}

// ─── Syntax highlighting (basic) ─────────────────────────

const HL_KEYWORDS = /\b(function|const|let|var|return|import|export|from|default|class|extends|new|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|async|await|yield|typeof|instanceof|in|of|void|delete|this|super|true|false|null|undefined|NaN|Infinity|def|print|self|lambda|yield|raise|try|except|finally|with|as|pass|elif|elif|and|or|not|is|None|True|False|pub|fn|mut|impl|trait|struct|enum|use|mod|crate|self|super|where|match|loop|move|ref|unsafe|async|move|dyn|type|interface|enum|namespace|abstract|implements|readonly|private|protected|public|static|get|set)\b/g;
const HL_STRINGS = /(["'`])(?:(?!\1|\\).|\\.)*\1/g;
const HL_NUMBERS = /\b\d+\.?\d*([eE][+-]?\d+)?\b/g;
const HL_COMMENTS = /(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)/gm;
const HL_FUNC = /\b([a-zA-Z_]\w*)\s*(?=\()/g;
const HL_TYPE = /\b([A-Z][a-zA-Z0-9_]+)\b/g;

function highlightCode(code: string, lang?: string): string {
	let escaped = code
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');

	// Comments first (so other rules don't interfere)
	escaped = escaped.replace(HL_COMMENTS, '<span class="hl-comment">$1</span>');
	// Strings
	escaped = escaped.replace(HL_STRINGS, '<span class="hl-string">$&</span>');
	// Keywords
	escaped = escaped.replace(HL_KEYWORDS, '<span class="hl-keyword">$&</span>');
	// Numbers
	escaped = escaped.replace(HL_NUMBERS, '<span class="hl-number">$&</span>');
	// Functions
	escaped = escaped.replace(HL_FUNC, '<span class="hl-func">$1</span>');
	// Types (PascalCase)
	escaped = escaped.replace(HL_TYPE, '<span class="hl-type">$1</span>');

	return escaped;
}

// ─── Markdown → HTML ─────────────────────────────────────

function renderMarkdown(text: string): string {
	const lines = text.split('\n');
	const out: string[] = [];
	let inCodeBlock = false;
	let codeLines: string[] = [];
	let codeLang = '';

	for (const line of lines) {
		// Fenced code blocks
		const fenceMatch = line.match(/^```(\w*)/);
		if (fenceMatch) {
			if (inCodeBlock) {
				out.push(`<pre class="code-block"><code>${highlightCode(codeLines.join('\n'), codeLang)}</code></pre>`);
				codeLines = [];
				codeLang = '';
				inCodeBlock = false;
			} else {
				inCodeBlock = true;
				codeLang = fenceMatch[1];
			}
			continue;
		}
		if (inCodeBlock) {
			codeLines.push(line);
			continue;
		}

		let html = line;

		// Headers
		const headerMatch = html.match(/^(#{1,6})\s+(.*)/);
		if (headerMatch) {
			const level = headerMatch[1].length;
			out.push(`<h${level} class="md-h${level}">${renderInline(headerMatch[2])}</h${level}>`);
			continue;
		}

		// Horizontal rule
		if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(html)) {
			out.push('<hr class="md-hr" />');
			continue;
		}

		// Unordered list
		const liMatch = html.match(/^(\s*)([-*+])\s+(.*)/);
		if (liMatch) {
			out.push(`<div class="md-li">${renderInline(liMatch[3])}</div>`);
			continue;
		}

		// Ordered list
		const oliMatch = html.match(/^(\s*)\d+\.\s+(.*)/);
		if (oliMatch) {
			out.push(`<div class="md-li">${renderInline(oliMatch[2])}</div>`);
			continue;
		}

		// Blockquote
		if (/^>\s/.test(html)) {
			out.push(`<blockquote class="md-quote">${renderInline(html.replace(/^>\s?/, ''))}</blockquote>`);
			continue;
		}

		// Empty line
		if (!html.trim()) {
			out.push('<br />');
			continue;
		}

		out.push(`<p>${renderInline(html)}</p>`);
	}

	// If we were in an unclosed code block
	if (inCodeBlock && codeLines.length) {
		out.push(`<pre class="code-block"><code>${highlightCode(codeLines.join('\n'), codeLang)}</code></pre>`);
	}

	return out.join('\n');
}

function renderInline(text: string): string {
	// Inline code (must be before other inline rules)
	text = text.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
	// Bold + italic
	text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
	// Bold
	text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
	text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
	// Italic
	text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
	text = text.replace(/_(.+?)_/g, '<em>$1</em>');
	// Strikethrough
	text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
	// Links [text](url)
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>');
	return text;
}

// ─── URL detection & linking ──────────────────────────────

const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/g;

function linkifyUrls(text: string): string {
	return text.replace(URL_REGEX, (url) => {
		const clean = url.replace(/[.,;:!?]+$/, '');
		const suffix = url.slice(clean.length);
		return `<a class="msg-link" href="${clean}" target="_blank" rel="noopener">${clean}</a>${suffix}`;
	});
}

// ─── Public API ───────────────────────────────────────────

export type RenderMode = 'auto' | 'text' | 'markdown' | 'code';

/**
 * Detect the best render mode for content.
 */
export function detectMode(text: string): RenderMode {
	// Explicit markdown?
	if (/^```|^#{1,6}\s|\*\*|__\*|~~\[.+\]\(/.test(text)) {
		return 'markdown';
	}
	// Code?
	if (looksLikeCode(text)) {
		return 'code';
	}
	return 'text';
}

/**
 * Render clipboard content to HTML.
 * - 'auto'    → detect mode automatically
 * - 'text'    → plain text with URL linking
 * - 'markdown' → full markdown render
 * - 'code'    → syntax highlighted code block
 */
export function renderContent(text: string, mode: RenderMode = 'auto'): string {
	const effective = mode === 'auto' ? detectMode(text) : mode;

	switch (effective) {
		case 'markdown':
			return renderMarkdown(text);
		case 'code': {
			const escaped = highlightCode(text);
			return `<pre class="code-block"><code>${escaped}</code></pre>`;
		}
		default:
			return linkifyUrls(escapeHtml(text));
	}
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
