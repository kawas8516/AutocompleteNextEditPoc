import { workspace } from "vscode";

/**
 * Root of the extension's settings namespace, matching the `runahead.*`
 * keys contributed in `extension/package.json`. Every settings read goes
 * through here so the namespace is defined in exactly one place.
 */
export const RUNAHEAD_WORKSPACE_KEY = "runahead";

export function getRunaheadWorkspaceConfig() {
  return workspace.getConfiguration(RUNAHEAD_WORKSPACE_KEY);
}
