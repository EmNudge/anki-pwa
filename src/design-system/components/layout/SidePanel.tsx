import { JSX, splitProps } from "solid-js";
import { css } from "solid-styled";

export interface SidePanelProps extends JSX.HTMLAttributes<HTMLDivElement> {
  title: string;
  /** Optional element to display in header (e.g., badge, icon) */
  headerAction?: JSX.Element;
  /** Max width of the panel */
  maxWidth?: string;
}

export function SidePanel(props: SidePanelProps) {
  const [local, others] = splitProps(props, ["title", "headerAction", "maxWidth", "children", "class"]);

  // eslint-disable-next-line no-unused-expressions
  css`
    .ds-side-panel {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .ds-side-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--color-border);
      padding-bottom: var(--spacing-2);
    }

    .ds-side-panel-title {
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-lg);
    }

    .ds-side-panel-content {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }
  `;

  const classes = () => ["ds-side-panel", local.class].filter(Boolean).join(" ");

  return (
    <div class={classes()} {...others}>
      <div class="ds-side-panel-header">
        <div class="ds-side-panel-title">{local.title}</div>
        {local.headerAction}
      </div>

      <div class="ds-side-panel-content">{local.children}</div>
    </div>
  );
}
