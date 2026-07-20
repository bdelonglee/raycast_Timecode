// Pure timecode arithmetic — no Raycast dependencies.

export type FpsKey =
  | "23.976"
  | "24"
  | "25"
  | "29.97ndf"
  | "29.97df"
  | "30"
  | "48"
  | "50"
  | "59.94ndf"
  | "59.94df"
  | "60";

export interface FpsConfig {
  key: FpsKey;
  label: string;
  nominalFps: number; // integer fps used in TC field arithmetic
  realFps: number;    // actual playback fps for real-time conversion
  dropFrame: boolean;
  dropCount: number;  // frames dropped per non-10th minute (0 for NDF)
}

export const FPS_CONFIGS: Record<FpsKey, FpsConfig> = {
  "23.976":   { key: "23.976",   label: "23.976",    nominalFps: 24, realFps: 24000 / 1001, dropFrame: false, dropCount: 0 },
  "24":       { key: "24",       label: "24",         nominalFps: 24, realFps: 24,            dropFrame: false, dropCount: 0 },
  "25":       { key: "25",       label: "25",         nominalFps: 25, realFps: 25,            dropFrame: false, dropCount: 0 },
  "29.97ndf": { key: "29.97ndf", label: "29.97 NDF", nominalFps: 30, realFps: 30000 / 1001, dropFrame: false, dropCount: 0 },
  "29.97df":  { key: "29.97df",  label: "29.97 DF",  nominalFps: 30, realFps: 30000 / 1001, dropFrame: true,  dropCount: 2 },
  "30":       { key: "30",       label: "30",         nominalFps: 30, realFps: 30,            dropFrame: false, dropCount: 0 },
  "48":       { key: "48",       label: "48",         nominalFps: 48, realFps: 48,            dropFrame: false, dropCount: 0 },
  "50":       { key: "50",       label: "50",         nominalFps: 50, realFps: 50,            dropFrame: false, dropCount: 0 },
  "59.94ndf": { key: "59.94ndf", label: "59.94 NDF", nominalFps: 60, realFps: 60000 / 1001, dropFrame: false, dropCount: 0 },
  "59.94df":  { key: "59.94df",  label: "59.94 DF",  nominalFps: 60, realFps: 60000 / 1001, dropFrame: true,  dropCount: 4 },
  "60":       { key: "60",       label: "60",         nominalFps: 60, realFps: 60,            dropFrame: false, dropCount: 0 },
};

export const FPS_ORDER: FpsKey[] = [
  "23.976", "24", "25", "29.97ndf", "29.97df", "30", "48", "50", "59.94ndf", "59.94df", "60",
];

export type TC = readonly [number, number, number, number]; // [hh, mm, ss, ff]

// Parse 1–8 compact digits, zero-padded on the left.
// "11151605" → [11,15,16,05]   "500" → [00,00,05,00]
export function parseTcInput(s: string): TC | null {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 1 || digits.length > 8) return null;
  const p = digits.padStart(8, "0");
  return [
    parseInt(p.slice(0, 2), 10),
    parseInt(p.slice(2, 4), 10),
    parseInt(p.slice(4, 6), 10),
    parseInt(p.slice(6, 8), 10),
  ] as const;
}

export function formatTc([hh, mm, ss, ff]: TC): string {
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, "0")).join(":");
}

export function validateTc([, mm, ss, ff]: TC, fps: FpsConfig): string | null {
  if (mm >= 60) return `minutes (${mm}) must be < 60`;
  if (ss >= 60) return `seconds (${ss}) must be < 60`;
  if (ff >= fps.nominalFps) return `frames (${ff}) must be < ${fps.nominalFps} at ${fps.label} fps`;
  return null;
}

// ── Frame counting ────────────────────────────────────────────────────────────

export function tcToFrames([hh, mm, ss, ff]: TC, fps: FpsConfig): number {
  const { nominalFps, dropFrame, dropCount } = fps;
  const raw = nominalFps * 3600 * hh + nominalFps * 60 * mm + nominalFps * ss + ff;
  if (!dropFrame) return raw;
  // SMPTE drop-frame: frame numbers :00/:01 (or :00–:03 for 59.94 DF) are
  // skipped on every minute that is NOT a multiple of 10.
  const totalMinutes = 60 * hh + mm;
  return raw - dropCount * (totalMinutes - Math.floor(totalMinutes / 10));
}

export function framesToTc(totalFrames: number, fps: FpsConfig): TC {
  const { nominalFps, dropFrame, dropCount } = fps;

  if (!dropFrame) {
    const ff = totalFrames % nominalFps;
    let rem = Math.floor(totalFrames / nominalFps);
    const ss = rem % 60;
    rem = Math.floor(rem / 60);
    const mm = rem % 60;
    const hh = Math.floor(rem / 60);
    return [hh, mm, ss, ff];
  }

  // Inverse SMPTE drop-frame — works for 29.97 DF (dropCount=2) and 59.94 DF (dropCount=4).
  const framesPerMin   = nominalFps * 60 - dropCount;       // 1798 / 3596
  const framesPer10Min = nominalFps * 600 - dropCount * 9;  // 17982 / 35964
  const framesPerHour  = framesPer10Min * 6;                // 107892 / 215784

  const hh = Math.floor(totalFrames / framesPerHour);
  let n = totalFrames % framesPerHour;

  const tens = Math.floor(n / framesPer10Min);
  n %= framesPer10Min;

  let mm: number, ss: number, ff: number;

  if (n < nominalFps * 60) {
    // First (non-drop) minute of every 10-minute group — all frame numbers present.
    mm = tens * 10;
    ss = Math.floor(n / nominalFps);
    ff = n % nominalFps;
  } else {
    // Remaining minutes each start at :dropCount, not :00.
    n -= nominalFps * 60;
    const extraMins = Math.floor(n / framesPerMin) + 1;
    n = (n % framesPerMin) + dropCount;
    mm = tens * 10 + extraMins;
    ss = Math.floor(n / nominalFps);
    ff = n % nominalFps;
  }

  return [hh, mm, ss, ff];
}

export function framesToRealSeconds(frames: number, fps: FpsConfig): number {
  return frames / fps.realFps;
}

// ── Expression parsing ────────────────────────────────────────────────────────

// An operand is a timecode ("11151605"), raw frames ("100f"), seconds ("30s" / "1.5s"), or minutes ("2m").
export type Operand =
  | { kind: "tc"; tc: TC }
  | { kind: "frames"; frames: number }
  | { kind: "seconds"; seconds: number }
  | { kind: "minutes"; minutes: number };

export type Expr =
  | { kind: "single"; a: Operand }
  | { kind: "binary"; a: Operand; op: "+" | "-"; b: Operand };

function parseOperand(s: string): Operand | null {
  const frameMatch = s.match(/^(\d+)f$/i);
  if (frameMatch) return { kind: "frames", frames: parseInt(frameMatch[1], 10) };
  const secondsMatch = s.match(/^(\d+(?:\.\d+)?)s$/i);
  if (secondsMatch) return { kind: "seconds", seconds: parseFloat(secondsMatch[1]) };
  const minutesMatch = s.match(/^(\d+(?:\.\d+)?)m$/i);
  if (minutesMatch) return { kind: "minutes", minutes: parseFloat(minutesMatch[1]) };
  const tc = parseTcInput(s);
  if (tc) return { kind: "tc", tc };
  return null;
}

function formatOperand(op: Operand): string {
  if (op.kind === "frames") return `${op.frames}f`;
  if (op.kind === "seconds") return `${op.seconds}s`;
  if (op.kind === "minutes") return `${op.minutes}m`;
  return formatTc(op.tc);
}

export function parseExpr(raw: string): Expr | null {
  const s = raw.trim();
  if (!s) return null;

  // Match: <operand> [+-] <operand>
  // Operand: digits (TC), digits+"f" (frames), or digits[.digits]+"s" (seconds)
  const bin = s.match(/^([\d.]+[fs]?)\s*([+\-])\s*([\d.]+[fs]?)$/i);
  if (bin) {
    const a = parseOperand(bin[1]);
    const b = parseOperand(bin[3]);
    if (a && b) return { kind: "binary", a, op: bin[2] as "+" | "-", b };
  }

  const single = parseOperand(s);
  if (single) return { kind: "single", a: single };

  return null;
}

// ── Evaluation ────────────────────────────────────────────────────────────────

export interface CalcResult {
  exprLabel: string;     // parsed interpretation: "11:15:16:05 − 100f"
  resultFrames: number;  // signed (negative when A < B in subtraction)
  resultTc: TC | null;   // null when resultFrames < 0
  absSeconds: number;    // |resultFrames| in real seconds
  fpsLabel: string;
  error?: string;
}

function operandToFrames(op: Operand, fps: FpsConfig): { frames: number; error?: string } {
  if (op.kind === "frames") return { frames: op.frames };
  if (op.kind === "seconds") return { frames: Math.round(op.seconds * fps.nominalFps) };
  if (op.kind === "minutes") return { frames: Math.round(op.minutes * 60 * fps.nominalFps) };
  const err = validateTc(op.tc, fps);
  if (err) return { frames: 0, error: err };
  return { frames: tcToFrames(op.tc, fps) };
}

export function evaluate(expr: Expr, fps: FpsConfig): CalcResult {
  if (expr.kind === "single") {
    const { frames, error } = operandToFrames(expr.a, fps);
    const label = formatOperand(expr.a);
    if (error) return { exprLabel: label, resultFrames: 0, resultTc: null, absSeconds: 0, fpsLabel: fps.label, error };
    return {
      exprLabel: label,
      resultFrames: frames,
      resultTc: framesToTc(frames, fps),
      absSeconds: framesToRealSeconds(frames, fps),
      fpsLabel: fps.label,
    };
  }

  const resA = operandToFrames(expr.a, fps);
  if (resA.error) {
    return { exprLabel: `${formatOperand(expr.a)} ${expr.op} ${formatOperand(expr.b)}`, resultFrames: 0, resultTc: null, absSeconds: 0, fpsLabel: fps.label, error: resA.error };
  }
  const resB = operandToFrames(expr.b, fps);
  if (resB.error) {
    return { exprLabel: `${formatOperand(expr.a)} ${expr.op} ${formatOperand(expr.b)}`, resultFrames: 0, resultTc: null, absSeconds: 0, fpsLabel: fps.label, error: resB.error };
  }

  const resultFrames = expr.op === "+" ? resA.frames + resB.frames : resA.frames - resB.frames;
  const opChar = expr.op === "+" ? "+" : "−";

  return {
    exprLabel: `${formatOperand(expr.a)} ${opChar} ${formatOperand(expr.b)}`,
    resultFrames,
    resultTc: resultFrames >= 0 ? framesToTc(resultFrames, fps) : null,
    absSeconds: framesToRealSeconds(Math.abs(resultFrames), fps),
    fpsLabel: fps.label,
  };
}
