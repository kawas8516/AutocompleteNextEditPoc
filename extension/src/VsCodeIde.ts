import * as vscode from "vscode";

import type {
  DocumentSymbol,
  FileStats,
  FileStatsMap,
  IDE,
  IdeInfo,
  Location,
  Range,
  RangeInFile,
  SignatureHelp,
} from "core";

/** Converts our plain `Range` to a `vscode.Range`. */
function toVscodeRange(range: Range): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character),
  );
}

/** Converts a `vscode.Range` to our plain `Range`. */
function fromVscodeRange(range: vscode.Range): Range {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

/**
 * Real, VS Code-backed implementation of the `core` `IDE` interface. This is
 * the seam the autocomplete/NextEdit pipeline uses for all filesystem/editor
 * access - unrelated to which LLM provider is configured.
 */
export class VsCodeIde implements IDE {
  async getIdeInfo(): Promise<IdeInfo> {
    return { ideType: "vscode" };
  }

  async getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
    const text = await vscode.env.clipboard.readText();
    return { text, copiedAt: new Date().toISOString() };
  }

  async getUniqueId(): Promise<string> {
    return vscode.env.machineId;
  }

  async getWorkspaceDirs(): Promise<string[]> {
    return (vscode.workspace.workspaceFolders ?? []).map((folder) =>
      folder.uri.toString(),
    );
  }

  async fileExists(fileUri: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.parse(fileUri));
      return true;
    } catch {
      return false;
    }
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.parse(path),
      new TextEncoder().encode(contents),
    );
  }

  async saveFile(fileUri: string): Promise<void> {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === fileUri,
    );
    await doc?.save();
  }

  async readFile(fileUri: string): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.parse(fileUri),
      );
      return new TextDecoder().decode(bytes);
    } catch (e) {
      console.warn(`VsCodeIde.readFile failed for ${fileUri}:`, e);
      return "";
    }
  }

  async readRangeInFile(fileUri: string, range: Range): Promise<string> {
    const contents = await this.readFile(fileUri);
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(fileUri),
    );
    return doc.getText(toVscodeRange(range)) ?? contents;
  }

  async getOpenFiles(): Promise<string[]> {
    return vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .map((tab) =>
        tab.input instanceof vscode.TabInputText
          ? tab.input.uri.toString()
          : undefined,
      )
      .filter((uri): uri is string => !!uri);
  }

  async getCurrentFile(): Promise<
    undefined | { isUntitled: boolean; path: string; contents: string }
  > {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    return {
      isUntitled: editor.document.isUntitled,
      path: editor.document.uri.toString(),
      contents: editor.document.getText(),
    };
  }

  async getFileStats(files: string[]): Promise<FileStatsMap> {
    const entries = await Promise.all(
      files.map(async (file): Promise<[string, FileStats] | undefined> => {
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.parse(file));
          return [file, { size: stat.size, lastModified: stat.mtime }];
        } catch {
          return undefined;
        }
      }),
    );
    return Object.fromEntries(
      entries.filter((e): e is [string, FileStats] => !!e),
    );
  }

  // LSP

  async gotoDefinition(location: Location): Promise<RangeInFile[]> {
    return this.executeGotoProvider(
      "vscode.executeDefinitionProvider",
      location,
    );
  }

  async gotoTypeDefinition(location: Location): Promise<RangeInFile[]> {
    return this.executeGotoProvider(
      "vscode.executeTypeDefinitionProvider",
      location,
    );
  }

  async getSignatureHelp(
    location: Location,
  ): Promise<SignatureHelp | null> {
    try {
      const result = await vscode.commands.executeCommand<vscode.SignatureHelp>(
        "vscode.executeSignatureHelpProvider",
        vscode.Uri.parse(location.filepath),
        new vscode.Position(
          location.position.line,
          location.position.character,
        ),
      );
      return (result as unknown as SignatureHelp) ?? null;
    } catch (e) {
      console.warn("VsCodeIde.getSignatureHelp failed:", e);
      return null;
    }
  }

  async getReferences(location: Location): Promise<RangeInFile[]> {
    return this.executeGotoProvider(
      "vscode.executeReferenceProvider",
      location,
    );
  }

  async getDocumentSymbols(
    textDocumentIdentifier: string,
  ): Promise<DocumentSymbol[]> {
    try {
      const result = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >(
        "vscode.executeDocumentSymbolProvider",
        vscode.Uri.parse(textDocumentIdentifier),
      );
      return (result ?? []) as unknown as DocumentSymbol[];
    } catch (e) {
      console.warn("VsCodeIde.getDocumentSymbols failed:", e);
      return [];
    }
  }

  // Callbacks

  onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void {
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        callback(editor.document.uri.toString());
      }
    });
  }

  private async executeGotoProvider(
    command:
      | "vscode.executeDefinitionProvider"
      | "vscode.executeTypeDefinitionProvider"
      | "vscode.executeReferenceProvider",
    location: Location,
  ): Promise<RangeInFile[]> {
    try {
      const results = await vscode.commands.executeCommand<any[]>(
        command,
        vscode.Uri.parse(location.filepath),
        new vscode.Position(
          location.position.line,
          location.position.character,
        ),
      );
      return (results ?? [])
        .filter((d) => (d.targetUri || d.uri) && (d.targetRange || d.range))
        .map((d) => ({
          filepath: (d.targetUri || d.uri).toString(),
          range: fromVscodeRange(d.targetRange || d.range),
        }));
    } catch (e) {
      console.warn(`VsCodeIde: ${command} failed:`, e);
      return [];
    }
  }
}
