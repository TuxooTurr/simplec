const BLOBS: {
  className: string;
  style: React.CSSProperties;
}[] = [
  {
    className: "bg-primary/50 dark:bg-primary/40",
    style: { top: "-10%", left: "-8%", width: "44vw", height: "44vw", ["--aurora-x" as string]: "10%", ["--aurora-y" as string]: "8%", ["--aurora-dur" as string]: "24s" },
  },
  {
    className: "bg-fuchsia-500/35 dark:bg-fuchsia-500/30",
    style: { top: "-6%", right: "-10%", width: "38vw", height: "38vw", ["--aurora-x" as string]: "-8%", ["--aurora-y" as string]: "10%", ["--aurora-dur" as string]: "30s" },
  },
  {
    className: "bg-cyan-400/25 dark:bg-cyan-400/25",
    style: { top: "18%", left: "20%", width: "30vw", height: "30vw", ["--aurora-x" as string]: "6%", ["--aurora-y" as string]: "-10%", ["--aurora-dur" as string]: "34s" },
  },
  {
    className: "bg-violet-500/30 dark:bg-violet-500/30",
    style: { top: "2%", left: "48%", width: "26vw", height: "26vw", ["--aurora-x" as string]: "-6%", ["--aurora-y" as string]: "-6%", ["--aurora-dur" as string]: "20s" },
  },
];

/** Ambient animated gradient backdrop for the landing hero — decorative only. */
export default function AuroraBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="absolute inset-0 bg-bg-main" />
      {BLOBS.map((b, i) => (
        <div key={i} className={`aurora-blob ${b.className}`} style={b.style} />
      ))}
      <div className="aurora-grain" />
      {/* Fade the aurora into the page background toward the bottom of the hero */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-bg-main" />
    </div>
  );
}
