import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { Tooltip, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { renderWithI18n } from '../../../tests/foundation/render-with-i18n.test-helper';
import { ToolTooltipContent } from './ToolTooltip';

const LONG_COMMAND =
  'cd /Users/someone/Documents/DEV/project && gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge && gh pr view 50 --json mergeable,mergeStateStatus,reviewDecision';

async function openTooltip(id: string): Promise<HTMLElement> {
  renderWithI18n(
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger>tool</TooltipTrigger>
        <ToolTooltipContent text={{ purpose: 'Runs a shell command', id }} />
      </Tooltip>
    </TooltipProvider>,
  );
  await userEvent.hover(screen.getByRole('button', { name: 'tool' }));
  return screen.findByTestId('agent-thread-tool-tooltip');
}

function overflowingChildren(surface: HTMLElement): string[] {
  const bounds = surface.getBoundingClientRect();
  return Array.from(surface.children)
    .filter((child) => child.getBoundingClientRect().right > bounds.right + 0.5)
    .map((child) => child.textContent ?? '');
}

describe('tool call tooltip layout', () => {
  test('a long command without spaces wraps inside the tooltip', async () => {
    const surface = await openTooltip(LONG_COMMAND);

    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth);
    expect(overflowingChildren(surface)).toEqual([]);
  });
});
