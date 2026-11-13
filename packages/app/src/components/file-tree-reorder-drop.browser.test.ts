import { FILE_TREE_TAG_NAME, FileTree, type FileTreeDropResult } from '@pierre/trees';
import { afterEach, describe, expect, test, vi } from 'vitest';

interface MountedTree {
  tree: FileTree;
  host: HTMLElement;
  drops: FileTreeDropResult[];
}

const mounted: MountedTree[] = [];

afterEach(() => {
  for (const { tree, host } of mounted.splice(0)) {
    tree.cleanUp();
    host.remove();
  }
});

async function mountTree(canReorder: boolean): Promise<MountedTree> {
  const host = document.createElement('div');
  host.style.cssText = 'width: 320px; height: 400px;';
  document.body.append(host);
  const drops: FileTreeDropResult[] = [];
  const tree = new FileTree({
    paths: ['docs/', 'docs/inner.md', 'alpha.md', 'beta.md', 'gamma.md'],
    initialExpansion: 'closed',
    initialVisibleRowCount: 10,
    dragAndDrop: {
      canReorder: () => canReorder,
      onDropComplete: (event) => drops.push(event),
    },
  });
  tree.render({ containerWrapper: host });
  await vi.waitFor(() => expect(rowFor(host, 'gamma.md')).not.toBeNull());
  const entry = { tree, host, drops };
  mounted.push(entry);
  return entry;
}

function rowFor(host: HTMLElement, path: string): HTMLElement | null {
  const element = host.querySelector(FILE_TREE_TAG_NAME);
  return (
    element?.shadowRoot?.querySelector<HTMLElement>(
      `[data-type="item"][data-item-path="${path}"]:not([data-file-tree-sticky-row])`,
    ) ?? null
  );
}

function dragEvent(type: string, row: HTMLElement, ratio: number, dataTransfer: DataTransfer) {
  const rect = row.getBoundingClientRect();
  return new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height * ratio,
    dataTransfer,
  });
}

async function dragOnto(host: HTMLElement, from: string, to: string, ratio: number) {
  const source = rowFor(host, from);
  if (!source) throw new Error(`no row for ${from}`);
  const dataTransfer = new DataTransfer();
  source.dispatchEvent(dragEvent('dragstart', source, 0.5, dataTransfer));
  const target = rowFor(host, to);
  if (!target) throw new Error(`no row for ${to}`);
  target.dispatchEvent(dragEvent('dragover', target, ratio, dataTransfer));
  await vi.waitFor(() => expect(rowFor(host, to)).not.toBeNull());
  return { dataTransfer, target: () => rowFor(host, to) };
}

function drop(host: HTMLElement, to: string, ratio: number, dataTransfer: DataTransfer) {
  const target = rowFor(host, to);
  if (!target) throw new Error(`no row for ${to}`);
  target.dispatchEvent(dragEvent('drop', target, ratio, dataTransfer));
}

describe('@pierre/trees reorder drop zones (local patch)', () => {
  test('the top quarter of a row marks it as a before-drop and reports a reorder', async () => {
    const { host, drops } = await mountTree(true);
    const { dataTransfer, target } = await dragOnto(host, 'gamma.md', 'alpha.md', 0.1);
    await vi.waitFor(() =>
      expect(target()?.getAttribute('data-item-drop-position')).toBe('before'),
    );

    drop(host, 'alpha.md', 0.1, dataTransfer);
    await vi.waitFor(() => expect(drops).toHaveLength(1));
    expect(drops[0]).toMatchObject({
      operation: 'reorder',
      draggedPaths: ['gamma.md'],
      target: { kind: 'root', hoveredPath: 'alpha.md', position: 'before' },
    });
  });

  test('the bottom quarter of a folder row is an after-drop in the folder parent, not a move into it', async () => {
    const { host, drops } = await mountTree(true);
    const { dataTransfer, target } = await dragOnto(host, 'beta.md', 'docs/', 0.9);
    await vi.waitFor(() => expect(target()?.getAttribute('data-item-drop-position')).toBe('after'));
    expect(target()?.hasAttribute('data-item-drag-target')).toBe(false);

    drop(host, 'docs/', 0.9, dataTransfer);
    await vi.waitFor(() => expect(drops).toHaveLength(1));
    expect(drops[0]).toMatchObject({
      operation: 'reorder',
      target: { kind: 'root', hoveredPath: 'docs/', position: 'after' },
    });
  });

  test('the middle of a folder row still moves into the folder', async () => {
    const { host, drops } = await mountTree(true);
    const { dataTransfer, target } = await dragOnto(host, 'beta.md', 'docs/', 0.5);
    await vi.waitFor(() => expect(target()?.hasAttribute('data-item-drag-target')).toBe(true));
    expect(target()?.hasAttribute('data-item-drop-position')).toBe(false);

    drop(host, 'docs/', 0.5, dataTransfer);
    await vi.waitFor(() => expect(drops).toHaveLength(1));
    expect(drops[0]).toMatchObject({
      operation: 'move',
      target: { kind: 'directory', directoryPath: 'docs/' },
    });
    expect(drops[0]?.target.position).toBeUndefined();
  });

  test('without canReorder the edge of a folder row keeps moving into the folder', async () => {
    const { host, drops } = await mountTree(false);
    const { dataTransfer, target } = await dragOnto(host, 'beta.md', 'docs/', 0.1);
    await vi.waitFor(() => expect(target()?.hasAttribute('data-item-drag-target')).toBe(true));
    expect(target()?.hasAttribute('data-item-drop-position')).toBe(false);

    drop(host, 'docs/', 0.1, dataTransfer);
    await vi.waitFor(() => expect(drops).toHaveLength(1));
    expect(drops[0]?.operation).toBe('move');
  });
});
