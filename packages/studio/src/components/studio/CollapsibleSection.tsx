/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  label: string;
  icon: LucideIcon;
  iconColor: string;
  count: number;
  children: React.ReactNode;
}

export function CollapsibleSection({ label, icon: Icon, iconColor, count, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted"
      >
        <ChevronRight
          className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconColor}`} />
        <span className="flex-1 text-left">{label}</span>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      </button>
      {open && <div className="pl-6 space-y-0.5 mt-0.5">{children}</div>}
    </div>
  );
}
