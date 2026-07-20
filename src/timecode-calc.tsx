import { ActionPanel, Action, List, Icon, Color, useNavigation } from "@raycast/api";
import { useLocalStorage } from "@raycast/utils";
import { useState, useMemo } from "react";
import {
  FpsKey, FPS_CONFIGS, FPS_ORDER,
  formatTc, parseExpr, evaluate, CalcResult,
} from "./timecode";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  const ms = Math.round(secs * 1000);
  const h  = Math.floor(ms / 3_600_000);
  const m  = Math.floor((ms % 3_600_000) / 60_000);
  const s  = Math.floor((ms % 60_000) / 1_000);
  const r  = ms % 1_000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}.${pad(r, 3)}`;
  if (m > 0) return `${m}:${pad(s)}.${pad(r, 3)}`;
  return `${s}.${pad(r, 3)} s`;
}

// ── Syntax reference ─────────────────────────────────────────────────────────

function HelpView() {
  return (
    <List navigationTitle="Syntax Reference" searchBarPlaceholder="Filter…">
      <List.Section title="Timecode input — compact digits, zero-padded left">
        <List.Item title="11151605" accessories={[{ text: "→  11:15:16:05" }]} />
        <List.Item title="500"      accessories={[{ text: "→  00:00:05:00" }]} />
        <List.Item title="10000000" accessories={[{ text: "→  10:00:00:00" }]} />
      </List.Section>
      <List.Section title="Suffixes">
        <List.Item title="(none)" subtitle="Timecode  HH:MM:SS:FF" accessories={[{ text: "11151605" }]} />
        <List.Item title="f"      subtitle="Raw frames"            accessories={[{ text: "100f" }]} />
        <List.Item title="s"      subtitle="Seconds"               accessories={[{ text: "30s · 1.5s" }]} />
        <List.Item title="m"      subtitle="Minutes"               accessories={[{ text: "2m · 0.5m" }]} />
      </List.Section>
      <List.Section title="Expression examples">
        <List.Item title="11151605 - 10000000" subtitle="TC minus TC" />
        <List.Item title="11151605 + 100f"     subtitle="TC plus raw frames" />
        <List.Item title="11151605 - 30s"      subtitle="TC minus 30 seconds" />
        <List.Item title="11151605 - 2m"       subtitle="TC minus 2 minutes" />
        <List.Item title="100f + 30s"          subtitle="mix any operand types freely" />
      </List.Section>
      <List.Section title="Output">
        <List.Item title="↵ on any result row"  subtitle="copy its value to clipboard" />
        <List.Item title="⌘K on any result row" subtitle="open action panel · change frame rate" />
      </List.Section>
    </List>
  );
}

// ── Frame rate selector ───────────────────────────────────────────────────────

function FpsSelector({ current, onSelect }: { current: FpsKey; onSelect: (k: FpsKey) => void }) {
  const { pop } = useNavigation();
  return (
    <List navigationTitle="Select Frame Rate" searchBarPlaceholder="Filter…">
      {FPS_ORDER.map((key) => (
        <List.Item
          key={key}
          title={FPS_CONFIGS[key].label}
          accessories={current === key ? [{ icon: { source: Icon.Checkmark, tintColor: Color.Green } }] : []}
          actions={
            <ActionPanel>
              <Action
                title="Select"
                onAction={() => {
                  onSelect(key);
                  pop();
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

// ── Result rows ───────────────────────────────────────────────────────────────

function ResultRows({ result, onChangeRate }: { result: CalcResult; onChangeRate: () => void }) {
  const fpsTag = `@ ${result.fpsLabel} fps`;

  const changeRateAction = (
    <Action title="Change Frame Rate" icon={Icon.Gear} onAction={onChangeRate} />
  );

  if (result.error) {
    return (
      <List.Item
        icon={{ source: Icon.ExclamationMark, tintColor: Color.Red }}
        title={result.error}
        subtitle={fpsTag}
        actions={<ActionPanel>{changeRateAction}</ActionPanel>}
      />
    );
  }

  const tcStr     = result.resultTc ? formatTc(result.resultTc) : null;
  const absFrames = Math.abs(result.resultFrames);
  const sign      = result.resultFrames < 0 ? "−" : "";
  const durStr    = fmtDuration(result.absSeconds);
  const msVal     = Math.round(result.absSeconds * 1000);

  return (
    <>
      {tcStr ? (
        <List.Item
          icon={Icon.Clock}
          title={tcStr}
          subtitle={fpsTag}
          accessories={[{ tag: { value: "timecode", color: Color.Blue } }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Timecode" content={tcStr} />
              {changeRateAction}
            </ActionPanel>
          }
        />
      ) : (
        <List.Item
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Orange }}
          title="Negative result — swap operands for a positive timecode"
          subtitle={fpsTag}
          actions={<ActionPanel>{changeRateAction}</ActionPanel>}
        />
      )}
      <List.Item
        icon={Icon.Hashtag}
        title={`${sign}${absFrames.toLocaleString()}`}
        subtitle={fpsTag}
        accessories={[{ tag: { value: "frames", color: Color.Purple } }]}
        actions={
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Frames" content={String(absFrames)} />
            {changeRateAction}
          </ActionPanel>
        }
      />
      <List.Item
        icon={Icon.Clock}
        title={`${sign}${durStr}`}
        subtitle={fpsTag}
        accessories={[{ tag: { value: "real time", color: Color.Green } }]}
        actions={
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Duration" content={`${sign}${durStr}`} />
            {changeRateAction}
          </ActionPanel>
        }
      />
      <List.Item
        icon={Icon.Clock}
        title={`${sign}${msVal.toLocaleString()} ms`}
        subtitle={fpsTag}
        accessories={[{ tag: { value: "ms", color: Color.Green } }]}
        actions={
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Milliseconds" content={String(msVal)} />
            {changeRateAction}
          </ActionPanel>
        }
      />
    </>
  );
}

// ── Main command ──────────────────────────────────────────────────────────────

export default function Command() {
  const { value: savedKey, setValue: saveKey } = useLocalStorage<FpsKey>("timecode-fps-key", "25");
  const [input, setInput] = useState("");
  const { push } = useNavigation();

  const fpsKey: FpsKey = (savedKey as FpsKey | undefined) ?? "25";
  const fps = FPS_CONFIGS[fpsKey];

  const result = useMemo(() => {
    const expr = parseExpr(input);
    return expr ? evaluate(expr, fps) : null;
  }, [input, fps]);

  function openFpsSelector() {
    push(
      <FpsSelector
        current={fpsKey}
        onSelect={(key) => {
          void saveKey(key);
        }}
      />,
    );
  }

  return (
    <List
      navigationTitle={`Timecode Calculator · ${fps.label} fps`}
      searchBarPlaceholder={`e.g. 11151605 - 10000000  or  11151605 - 100f  or  11151605 - 30s  ·  ${fps.label} fps`}
      onSearchTextChange={setInput}
      filtering={false}
    >
      {result ? (
        <List.Section title={result.exprLabel}>
          <ResultRows result={result} onChangeRate={openFpsSelector} />
        </List.Section>
      ) : input ? (
        <List.Item
          icon={{ source: Icon.ExclamationMark, tintColor: Color.Orange }}
          title="Could not parse expression"
          subtitle='try:  11151605   or   11151605 - 10000000'
        />
      ) : (
        // No input yet — show settings and help. Hidden while results are visible.
        <List.Section title="Settings">
          <List.Item
            icon={Icon.Gear}
            title="Frame Rate"
            subtitle={`${fps.label} fps — press Enter to change`}
            actions={
              <ActionPanel>
                <Action title="Change Frame Rate" onAction={openFpsSelector} />
              </ActionPanel>
            }
          />
          <List.Item
            icon={Icon.Info}
            title="Syntax Reference"
            subtitle="timecode · f frames · s seconds · m minutes"
            actions={
              <ActionPanel>
                <Action title="View Syntax" onAction={() => push(<HelpView />)} />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
    </List>
  );
}
