import { STAGE_LABEL, treeStage } from "@/core/tasks";

/**
 * The growing tree (core/tasks.ts): a sprout on Monday, a blossoming tree at
 * 100%. Drawn in SVG, no images. It only ever grows within a week, and an
 * unfinished week is planted smaller, never withered.
 */
const TRUNK = "#7a5a3a";
const LEAF = "#2f7d4f";
const LEAF_LIGHT = "#5aa36f";
const BLOSSOM = "#e48aa8";
const GROUND = "#e3e6ef";

// Canopy blobs (x, y, r) of the full tree; smaller stages scale them down.
const BLOBS: [number, number, number][] = [
  [100, 70, 34],
  [72, 86, 26],
  [128, 86, 26],
  [86, 56, 24],
  [116, 54, 24],
  [100, 98, 24],
  [60, 104, 18],
  [140, 104, 18],
];
const FLOWERS: [number, number][] = [
  [80, 60], [112, 46], [134, 78], [66, 92], [98, 84], [124, 102], [86, 106], [146, 98], [58, 108], [104, 62], [92, 40],
];

export function TreeSvg({ pct, size = 180, label }: { pct: number; size?: number; label: string }) {
  const stage = treeStage(pct);
  // Smooth growth inside the week: 0% is a sprout, 100% the full tree.
  const g = Math.max(0, Math.min(1, pct / 100));
  const trunkTop = 160 - (stage <= 2 ? 50 + g * 110 : 70 + g * 30);
  const trunkW = stage <= 2 ? 4 : 8 + g * 8;
  const canopy = stage <= 2 ? 0 : 0.72 + g * 0.28;
  return (
    <svg viewBox="0 0 200 180" width={size} height={(size * 180) / 200} role="img" aria-label={`${label}: ${pct}% grown, ${STAGE_LABEL[stage].toLowerCase()} (stage ${stage} of 6)`} className="tree-svg">
      <ellipse cx="100" cy="164" rx="70" ry="10" fill={GROUND} />
      <path d={`M${100 - trunkW / 2} 164 L${100 - trunkW / 3} ${trunkTop} L${100 + trunkW / 3} ${trunkTop} L${100 + trunkW / 2} 164 Z`} fill={stage <= 2 ? LEAF : TRUNK} />
      {stage <= 2 && (
        <g className="tree-grow">
          <ellipse cx={100 - 17} cy={trunkTop + 6} rx="18" ry="8" fill={LEAF_LIGHT} transform={`rotate(-25 ${100 - 17} ${trunkTop + 6})`} />
          <ellipse cx={100 + 17} cy={trunkTop + 2} rx="18" ry="8" fill={LEAF} transform={`rotate(25 ${100 + 17} ${trunkTop + 2})`} />
          {stage === 2 && (
            <>
              <ellipse cx={100 - 17} cy={trunkTop + 30} rx="18" ry="8" fill={LEAF} transform={`rotate(-20 ${100 - 17} ${trunkTop + 30})`} />
              <ellipse cx={100 + 17} cy={trunkTop + 26} rx="18" ry="8" fill={LEAF_LIGHT} transform={`rotate(20 ${100 + 17} ${trunkTop + 26})`} />
            </>
          )}
        </g>
      )}
      {stage >= 3 && (
        <g className="tree-grow" style={{ transform: `translate(100px, 160px) scale(${canopy}) translate(-100px, -160px)` }}>
          {BLOBS.slice(0, stage === 3 ? 4 : stage === 4 ? 6 : 8).map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y + 20} r={r} fill={i % 2 ? LEAF_LIGHT : LEAF} />
          ))}
          {stage === 6 && FLOWERS.map(([x, y], i) => <circle key={`f${i}`} cx={x} cy={y + 20} r="4.5" fill={BLOSSOM} stroke="#ffffff" strokeWidth="1.5" />)}
        </g>
      )}
    </svg>
  );
}

/** Past weeks, each planted at the size it reached. */
export function Grove({ weeks, label }: { weeks: { week: string; done: number; total: number }[]; label: string }) {
  weeks = weeks.filter((w) => w.total > 0);
  if (!weeks.length) return <p className="secondary">Finished weeks are planted here, starting next Monday.</p>;
  return (
    <ul className="grove" aria-label={label}>
      {weeks.map((w) => {
        const pct = w.total ? Math.min(100, Math.round((w.done / w.total) * 100)) : 0;
        const day = new Date(`${w.week}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
        return (
          <li key={w.week} title={`Week of ${day}: ${pct}%`}>
            <TreeSvg pct={pct} size={56} label={`Week of ${day}`} />
            <span className="grove-label">{day}</span>
          </li>
        );
      })}
    </ul>
  );
}
