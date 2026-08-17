import type { DiffChar, DiffLine } from "../index.js";

/**
 * Colors for the rendered diff preview. Chosen to read acceptably against both
 * light and dark editor backgrounds, since the SVG is drawn as an image
 * decoration and cannot inherit the editor's theme colors.
 */
const COLORS = {
  added: "#5DBA79",
  removed: "#D9707A",
  unchanged: "#B8B8B8",
  background: "#1E1E1E",
  border: "#666667",
};

const BACKGROUND_OPACITY = 0.95;

/** Escapes the five characters that are not legal as raw XML text content. */
function escapeForSVG(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colorForDiffType(type: DiffLine["type"]): string {
  switch (type) {
    case "new":
      return COLORS.added;
    case "old":
      return COLORS.removed;
    default:
      return COLORS.unchanged;
  }
}

function prefixForDiffType(type: DiffLine["type"]): string {
  switch (type) {
    case "new":
      return "+ ";
    case "old":
      return "- ";
    default:
      return "  ";
  }
}

/**
 * Renders a NextEdit preview as a self-contained SVG data URI.
 *
 * `NextEditWindowManager` draws the result as a `before.contentIconPath`
 * image decoration floating over the editable region, and owns all the
 * sizing/positioning; this class is only responsible for producing the image.
 *
 * Deliberately dependency-free: the original implementation used shiki (for
 * syntax highlighting) plus jsdom to convert highlighted HTML into SVG, which
 * is several megabytes of dependency for a preview tooltip. This builds the
 * SVG by hand instead - the same approach `JumpManager` already uses for its
 * jump label - trading syntax coloring for a much smaller footprint. Lines are
 * instead colored by their diff type, which is the information that actually
 * matters in an edit preview.
 */
export class CodeRenderer {
  private static instance: CodeRenderer;

  static getInstance(): CodeRenderer {
    if (!CodeRenderer.instance) {
      CodeRenderer.instance = new CodeRenderer();
    }
    return CodeRenderer.instance;
  }

  /**
   * Retained for API compatibility with the previous shiki-backed renderer,
   * which needed to preload a highlighter theme. Colors are now fixed, so
   * there is nothing to configure.
   */
  async setTheme(_theme: string): Promise<void> {
    // No theme state to set - see the class comment.
  }

  async getDataUri(
    text: string,
    _languageId: string,
    options: {
      imageType: "svg";
      fontSize: number;
      fontFamily: string;
      dimensions: { width: number; height: number };
      lineHeight: number;
    },
    _currLineOffsetFromTop: number,
    newDiffLines: DiffLine[],
    _diffChars: DiffChar[],
  ): Promise<string> {
    const { fontSize, fontFamily, dimensions, lineHeight } = options;

    // Prefer the structured diff so each line can be colored by its role.
    // Fall back to the raw text when no diff was supplied, so the preview
    // still shows something rather than rendering blank.
    const lines: DiffLine[] =
      newDiffLines.length > 0
        ? newDiffLines
        : text.split("\n").map((line) => ({ type: "same" as const, line }));

    const paddingX = Math.ceil(fontSize * 0.6);
    const paddingY = Math.ceil(fontSize * 0.4);

    const textElements = lines
      .map((diffLine, index) => {
        const y = paddingY + (index + 1) * lineHeight - Math.ceil(fontSize / 4);
        const content = escapeForSVG(
          `${prefixForDiffType(diffLine.type)}${diffLine.line}`,
        );
        return `  <text x="${paddingX}" y="${y}" xml:space="preserve" font-family="${escapeForSVG(
          fontFamily,
        )}" font-size="${fontSize}" fill="${colorForDiffType(
          diffLine.type,
        )}">${content}</text>`;
      })
      .join("\n");

    const svg = `<svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${dimensions.width}" height="${dimensions.height}" rx="3" fill="${COLORS.background}" fill-opacity="${BACKGROUND_OPACITY}" stroke="${COLORS.border}" stroke-width="1" />
${textElements}
</svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }
}
