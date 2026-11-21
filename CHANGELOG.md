# Changelog

User-facing changes in each OpenKnowledge16 release, newest first.

## 0.84.0 (2026-11-21)

### Features

- SVG files open as a picture you can zoom and pan, and a toggle above the file switches to its source and back. Each SVG remembers its own choice until the app restarts, and switching does not change how your Markdown files open.

### Changes

- Clicking an image in a document opens it in a viewer where trackpad pinch, Cmd/Ctrl-scroll and the corner buttons zoom, and scrolling or dragging pans. Press Escape or the close button to return.

## 0.83.0 (2026-11-21)

### Changes

- The bar above a document now shows the open file's name in bold after its folders, so you can tell which file you are reading without looking at the tab or the sidebar. Deep folders collapse to the parent folder, and on narrow screens only the file name is shown.

## 0.82.0 (2026-11-21)

### Features

- Images opened in their own tab can be zoomed and moved: pinch or Cmd/Ctrl-scroll to zoom, drag or scroll to pan, and use the zoom, pan and reset buttons in the corner.

## 0.81.1 (2026-11-21)

### Changes

- Sorting the file tree by name now follows Finder: names starting with `_` or another symbol come before names starting with a digit, accented letters sit next to their base letter, and scripts are ordered by your system language (on a Korean system, Hangul names come before English ones).

## 0.81.0 (2026-11-21)

### Fixes

- On a phone, tapping a folder in the Files sidebar now expands or collapses it instead of closing the sidebar.

### Changes

- On phones, buttons, tabs and file tree rows are easier to tap, and the Files and document panels slide in and close with a swipe. Long-press a file or folder to open its actions. Inputs no longer zoom the page, and pulling down no longer reloads the app.
- Each release now comes with notes on its GitHub release page and in the docs changelog, which lists OpenKnowledge16 releases instead of upstream ones.

## 0.80.0 (2026-11-18)

### Features

- Connect your Notion workspaces in Settings → Integrations → Notion. Each workspace is connected once per user, so a company and a personal workspace can sit side by side.
- With the Notion plugin on, link a document to a Notion page and publish it there from the editor toolbar. OpenKnowledge stays the place you write; the Notion page is its copy.
- Edits made on the Notion page come back when you publish or choose Take edits from Notion: changes to different lines merge on their own, and changes to the same lines open in the conflict view with Keep this document and Keep Notion.
- The Comments tab of a linked document lists the Notion page's open discussions, with the passage each one is on, and you can reply from OpenKnowledge under your own name.

### Fixes

- Resolving a merge conflict no longer fails now and then with a git "index.lock" error.

### Changes

- From upstream: the desktop app runs on Electron 44.11.3, and managed agents run on Node 24.22.3.
- From upstream: pages embedded in a document can no longer open other apps, and downloading an ACP agent that cannot be verified asks for confirmation first.
- From upstream: the Agent Catalog request goes through the configured proxy, and `ok mcp` writes its logs to stderr.

## 0.79.2 (2026-11-17)

### Fixes

- Long commands in a tool call's tooltip wrap instead of running off the edge.

## 0.79.1 (2026-11-16)

### Features

- Copy any image in a document from its context menu in the desktop app.

### Fixes

- Outside the desktop app, document images keep the browser's own context menu.

## 0.79.0 (2026-11-16)

### Features

- Images that a tool call read appear as previews in the agent thread.

### Fixes

- Agent logs no longer store every copy of a tool result in full.

## 0.78.7 (2026-11-15)

### Fixes

- A tool's tooltip shows its purpose above its command instead of beside it.
- The MCP server the app launches runs on the OpenKnowledge16 channel, so it uses OpenKnowledge16's settings rather than upstream's.

### Changes

- OpenKnowledge16 is macOS-only: Windows installers, setup guidance and Windows-specific code paths are gone.

## 0.78.6 (2026-11-14)

### Changes

- Release tooling only; nothing changes in the app.

## 0.78.5 (2026-11-14)

### Changes

- Release tooling only; nothing changes in the app.

## 0.78.4 (2026-11-14)

### Changes

- Release tooling only; nothing changes in the app.

## 0.78.3 (2026-11-14)

### Changes

- Release tooling only; nothing changes in the app.

## 0.78.2 (2026-11-14)

### Changes

- Release tooling only; nothing changes in the app.

## 0.78.1 (2026-11-14)

### Fixes

- The desktop app can download its own updates.

## 0.78.0 (2026-11-14)

### Features

- Sort the file tree by name or by date, in either direction, from the tree view options menu.
- Give any folder its own sort order from its context menu.

### Fixes

- The file tree keeps its last sort settings on screen while settings sync.

## 0.77.0 (2026-11-13)

### Features

- Order the file tree by hand: switch to Sort manually and drag rows into place. Renames and moves keep the order.
- Choose the file tree sort order from the View menu and the command palette.

### Changes

- The first release under plain version numbers; earlier builds were tagged `X.Y.Z-identity16.N`.
