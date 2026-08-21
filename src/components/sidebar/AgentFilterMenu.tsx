// Agents filter menu — grouping, ordering, and what to show.
// Opens from the funnel; never hides the Agents header, so Reset is always reachable.

import type { ReactElement, ReactNode } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { CaretRight, Check } from "@phosphor-icons/react";
import { closeAutoFocus } from "../../lib/modality";
import {
  useMustr,
  type AgentGroupBy,
  type AgentOrder,
  type AgentShow,
} from "../../state/store";
import type { AgentStatus } from "../../bridge/herdr";
import {
  MENU_CHECK,
  MENU_CONTENT,
  MENU_ITEM,
  MENU_ITEM_CHECK,
  MENU_SEPARATOR,
  MENU_SHADOW,
  MENU_SUB,
} from "../ui/menu";

const GROUP_LABEL: Record<AgentGroupBy, string> = {
  status: "Status",
  space: "Space",
};
const ORDER_LABEL: Record<AgentOrder, string> = {
  attention: "Attention",
  recent: "Recent",
  name: "Name",
};
const SHOW_LABEL: Record<AgentShow, string> = {
  all: "All",
  active: "Active",
  "hide-idle": "Hide idle",
  "hide-done": "Hide done",
};
const STATUS_FILTERS: { id: AgentStatus; label: string }[] = [
  { id: "blocked", label: "Needs input" },
  { id: "working", label: "Working" },
  { id: "done", label: "Done" },
  { id: "idle", label: "Idle" },
];

export function agentViewDirty(st: {
  agentGroupBy: AgentGroupBy;
  agentOrder: AgentOrder;
  agentShow: AgentShow;
  agentStatuses: AgentStatus[] | null;
  agentNames: string[] | null;
}): boolean {
  return (
    st.agentGroupBy !== "status" ||
    st.agentOrder !== "attention" ||
    st.agentShow !== "all" ||
    st.agentStatuses !== null ||
    st.agentNames !== null
  );
}

function SubMenu({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger className={`${MENU_SUB} text-text-primary`}>
        <span>{label}</span>
        <span className="flex min-w-0 items-center gap-1 text-text-muted">
          <span className="truncate">{value}</span>
          <CaretRight size={10} weight="bold" className="shrink-0" aria-hidden />
        </span>
      </Dropdown.SubTrigger>
      <Dropdown.Portal>
        <Dropdown.SubContent
          sideOffset={4}
          alignOffset={-4}
          className={`${MENU_CONTENT} min-w-[148px]`}
          style={MENU_SHADOW}
        >
          {children}
        </Dropdown.SubContent>
      </Dropdown.Portal>
    </Dropdown.Sub>
  );
}

function RadioChoice({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Dropdown.RadioItem value={value} className={`${MENU_ITEM_CHECK} text-text-primary`}>
      <Dropdown.ItemIndicator className={MENU_CHECK}>
        <Check size={12} weight="bold" aria-hidden />
      </Dropdown.ItemIndicator>
      {children}
    </Dropdown.RadioItem>
  );
}

function CheckChoice({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: () => void;
  children: ReactNode;
}) {
  return (
    <Dropdown.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(e) => e.preventDefault()}
      className={`${MENU_ITEM_CHECK} text-text-primary`}
    >
      <Dropdown.ItemIndicator className={MENU_CHECK}>
        <Check size={12} weight="bold" aria-hidden />
      </Dropdown.ItemIndicator>
      {children}
    </Dropdown.CheckboxItem>
  );
}

export function AgentFilterMenu({ trigger }: { trigger: ReactElement }) {
  const panes = useMustr((s) => s.panes);
  const agentGroupBy = useMustr((s) => s.agentGroupBy);
  const agentOrder = useMustr((s) => s.agentOrder);
  const agentShow = useMustr((s) => s.agentShow);
  const agentStatuses = useMustr((s) => s.agentStatuses);
  const agentNames = useMustr((s) => s.agentNames);
  const setAgentGroupBy = useMustr((s) => s.setAgentGroupBy);
  const setAgentOrder = useMustr((s) => s.setAgentOrder);
  const setAgentShow = useMustr((s) => s.setAgentShow);
  const toggleAgentStatus = useMustr((s) => s.toggleAgentStatus);
  const toggleAgentName = useMustr((s) => s.toggleAgentName);
  const resetAgentView = useMustr((s) => s.resetAgentView);

  const names = [...new Set(panes.map((p) => p.agent).filter(Boolean) as string[])].sort((a, b) =>
    a.localeCompare(b),
  );
  const dirty = agentViewDirty({
    agentGroupBy,
    agentOrder,
    agentShow,
    agentStatuses,
    agentNames,
  });
  const statusOn = agentStatuses ?? STATUS_FILTERS.map((s) => s.id);
  const nameOn = agentNames ?? names;

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          onCloseAutoFocus={closeAutoFocus}
          side="bottom"
          align="end"
          sideOffset={4}
          className={`${MENU_CONTENT} min-w-[224px]`}
          style={MENU_SHADOW}
        >
          <SubMenu label="Grouping" value={GROUP_LABEL[agentGroupBy]}>
            <Dropdown.RadioGroup value={agentGroupBy} onValueChange={(v) => setAgentGroupBy(v as AgentGroupBy)}>
              <RadioChoice value="status">Status</RadioChoice>
              <RadioChoice value="space">Space</RadioChoice>
            </Dropdown.RadioGroup>
          </SubMenu>

          <SubMenu label="Ordering" value={ORDER_LABEL[agentOrder]}>
            <Dropdown.RadioGroup value={agentOrder} onValueChange={(v) => setAgentOrder(v as AgentOrder)}>
              <RadioChoice value="attention">Attention</RadioChoice>
              <RadioChoice value="recent">Recent</RadioChoice>
              <RadioChoice value="name">Name</RadioChoice>
            </Dropdown.RadioGroup>
          </SubMenu>

          <SubMenu label="Show" value={SHOW_LABEL[agentShow]}>
            <Dropdown.RadioGroup value={agentShow} onValueChange={(v) => setAgentShow(v as AgentShow)}>
              <RadioChoice value="all">All agents</RadioChoice>
              <RadioChoice value="active">Active only</RadioChoice>
              <RadioChoice value="hide-idle">Hide idle</RadioChoice>
              <RadioChoice value="hide-done">Hide done</RadioChoice>
            </Dropdown.RadioGroup>
          </SubMenu>

          <Dropdown.Separator className={MENU_SEPARATOR} />

          <div className="flex h-6 items-center px-2">
            <span className="text-[11px] font-medium text-text-muted">Filters</span>
            <Dropdown.Item
              disabled={!dirty}
              onSelect={() => resetAgentView()}
              className={`${MENU_ITEM} ml-auto w-auto px-1.5 text-text-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-40`}
            >
              Reset
            </Dropdown.Item>
          </div>

          <SubMenu
            label="Status"
            value={agentStatuses == null ? "All" : `${agentStatuses.length} selected`}
          >
            {STATUS_FILTERS.map((s) => (
              <CheckChoice
                key={s.id}
                checked={statusOn.includes(s.id)}
                onCheckedChange={() => toggleAgentStatus(s.id)}
              >
                {s.label}
              </CheckChoice>
            ))}
          </SubMenu>

          {names.length > 1 && (
            <SubMenu
              label="Agent"
              value={agentNames == null ? "All" : `${agentNames.length} selected`}
            >
              {names.map((name) => (
                <CheckChoice
                  key={name}
                  checked={nameOn.includes(name)}
                  onCheckedChange={() => toggleAgentName(name, names)}
                >
                  {name}
                </CheckChoice>
              ))}
            </SubMenu>
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
