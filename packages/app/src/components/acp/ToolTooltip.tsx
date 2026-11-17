import type { ReactNode } from 'react';
import { TooltipContent } from '@/components/ui/tooltip';
import { describeToolPurpose } from '@/lib/acp/tool-call-display';

export interface ToolTooltipText {
  purpose: string | null;
  id: string;
}

export function toolTooltipText(
  call: { title: string; toolKind: string; rawInput: unknown },
  labelText: string,
): ToolTooltipText | null {
  const purpose = describeToolPurpose(call);
  if (purpose === null && call.title === labelText) return null;
  return { purpose, id: call.title };
}

export function toolTitleText(text: ToolTooltipText | null): string | undefined {
  if (text === null) return undefined;
  return text.purpose === null ? text.id : `${text.purpose}\n${text.id}`;
}

export function ToolTooltipContent({ text }: { text: ToolTooltipText }): ReactNode {
  return (
    <TooltipContent
      side="top"
      align="start"
      sideOffset={6}
      arrow={false}
      className="max-w-72 flex-col items-start gap-0.5 border border-border bg-popover text-popover-foreground shadow-md wrap-anywhere"
      data-testid="agent-thread-tool-tooltip"
    >
      {text.purpose !== null ? <span className="block">{text.purpose}</span> : null}
      <span className="block font-mono text-[10px] text-muted-foreground" dir="ltr">
        {text.id}
      </span>
    </TooltipContent>
  );
}
