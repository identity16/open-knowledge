import type { EditorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAssetContextMenuPlugin } from './asset-context-menu';

const mounted: Array<{ destroy?: () => void }> = [];

function mountWithImage(
  showAssetMenu?: Parameters<typeof createAssetContextMenuPlugin>[0]['showAssetMenu'],
) {
  const dom = document.createElement('div');
  const img = document.createElement('img');
  img.setAttribute('src', './photo.png');
  dom.append(img);
  document.body.append(dom);
  const plugin = createAssetContextMenuPlugin({ sourceDocName: 'notes/today', showAssetMenu });
  const view = plugin.spec.view?.({ dom } as unknown as EditorView);
  mounted.push({ destroy: () => view?.destroy?.() });
  return img;
}

function rightClick(target: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 30,
    clientY: 12,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const view of mounted.splice(0)) view.destroy?.();
  document.body.innerHTML = '';
});

describe('asset context menu plugin', () => {
  test('without a desktop menu it leaves the browser menu alone', () => {
    const event = rightClick(mountWithImage());
    expect(event.defaultPrevented).toBe(false);
  });

  test('with a desktop menu it asks for the image menu at the click point', () => {
    const showAssetMenu = vi.fn(() => Promise.resolve());
    const event = rightClick(mountWithImage(showAssetMenu));
    expect(event.defaultPrevented).toBe(true);
    expect(showAssetMenu).toHaveBeenCalledWith({
      kind: 'image',
      relPath: 'notes/photo.png',
      title: 'photo.png',
      point: { x: 30, y: 12 },
    });
  });
});
