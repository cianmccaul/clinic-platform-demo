import { Fragment } from "react";
import { Icon, Notice } from "@/components/Brand";
import { anchorFor, parseInline, resolveHref } from "@/core/guides/inline";
import { AUDIENCE_LABEL, type Block, type Guide, type GuideStep, type ResolvedShot } from "@/core/guides/types";

/**
 * Shows one guide: steps with a picture each and the part to press circled.
 * Purely presentational (no state, no data fetching), so the public help
 * centre renders it on the server and the dashboard renders it from the
 * staff guides API. The circles are drawn over the screenshot, not baked in,
 * so they stay sharp at any size (docs/guides.md).
 */

export function Inline({ text, book }: { text: string; book: string }) {
  return (
    <>
      {parseInline(text).map((t, i) =>
        t.kind === "bold" ? (
          <strong key={i}>{t.text}</strong>
        ) : t.kind === "code" ? (
          <code key={i}>{t.text}</code>
        ) : t.kind === "link" ? (
          <a key={i} href={resolveHref(t.href, book)}>
            {t.text}
          </a>
        ) : (
          <Fragment key={i}>{t.text}</Fragment>
        )
      )}
    </>
  );
}

/** A Loom video with its chapters, or "coming soon" until it's recorded (types.ts). */
function Video({ block }: { block: Extract<Block, { type: "video" }> }) {
  const loom = !!block.loomId && /^[a-f0-9]{32}$/.test(block.loomId);
  return (
    <figure className="guide-video">
      {block.src ? (
        <div className="guide-video-frame">
          <video src={block.src} poster={block.poster} controls preload="metadata" playsInline title={block.title} />
        </div>
      ) : loom ? (
        <div className="guide-video-frame">
          <iframe
            src={`https://www.loom.com/embed/${block.loomId}?hide_owner=true&hide_share=true&hide_title=true`}
            title={block.title}
            allow="fullscreen"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <div className="guide-video-frame is-empty">
          <Icon name="clock" />
          <span>Video coming soon</span>
        </div>
      )}
      <figcaption>
        <strong>{block.title}</strong> · about {block.minutes} min
        {block.chapters.length > 0 && (
          <ol className="guide-video-chapters">
            {block.chapters.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        )}
      </figcaption>
    </figure>
  );
}

const PAD = 10; // space between the thing and its circle, in screenshot pixels

export function Shot({ shot, alt, caption, book }: { shot: ResolvedShot; alt: string; caption?: string; book: string }) {
  const { width, height } = shot;
  return (
    <figure className={`guide-shot is-${shot.device}`}>
      <a className="guide-shot-frame" href={shot.src} target="_blank" rel="noopener" style={{ aspectRatio: `${width} / ${height}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shot.src} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
        <span className="visually-hidden"> (opens full size in a new tab)</span>
        {shot.marks.length > 0 && (
          <svg className="guide-marks" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {shot.marks.map((m, i) => {
              const x = Math.max(m.x * width - PAD, 2);
              const y = Math.max(m.y * height - PAD, 2);
              const w = Math.min(m.w * width + PAD * 2, width - x - 2);
              const h = Math.min(m.h * height + PAD * 2, height - y - 2);
              const r = Math.min(h / 2, 32);
              return (
                <g key={i}>
                  <rect className="guide-mark-halo" x={x} y={y} width={w} height={h} rx={r} ry={r} vectorEffect="non-scaling-stroke" />
                  <rect className="guide-mark" x={x} y={y} width={w} height={h} rx={r} ry={r} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </svg>
        )}
      </a>
      {caption && (
        <figcaption>
          <Inline text={caption} book={book} />
        </figcaption>
      )}
    </figure>
  );
}

function StepItem({ step, shots, book }: { step: GuideStep; shots: Record<string, ResolvedShot>; book: string }) {
  const shot = step.shot ? shots[step.shot.id] : undefined;
  return (
    <li className={`guide-step${shot ? " has-shot" : ""}`}>
      <div className="guide-step-text">
        <p>
          <Inline text={step.text} book={book} />
        </p>
        {step.more?.map((m, i) => (
          <p key={i} className="secondary">
            <Inline text={m} book={book} />
          </p>
        ))}
      </div>
      {shot && step.shot && <Shot shot={shot} alt={step.shot.alt} book={book} />}
    </li>
  );
}

function BlockView({ block, shots, book }: { block: Block; shots: Record<string, ResolvedShot>; book: string }) {
  switch (block.type) {
    case "heading":
      return <h2 id={anchorFor(block.text)}>{block.text}</h2>;
    case "text":
      return (
        <p>
          <Inline text={block.text} book={book} />
        </p>
      );
    case "steps":
      return (
        <ol className="guide-steps" role="list">
          {block.steps.map((s, i) => (
            <StepItem key={i} step={s} shots={shots} book={book} />
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="guide-list">
          {block.items.map((t, i) => (
            <li key={i}>
              <Inline text={t} book={book} />
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="table-wrap">
          <table className="guide-table">
            <thead>
              <tr>
                {block.head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) =>
                    j === 0 ? (
                      <th key={j} scope="row">
                        <Inline text={cell} book={book} />
                      </th>
                    ) : (
                      <td key={j}>
                        <Inline text={cell} book={book} />
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <Notice tone={block.tone} title={block.title} quiet>
          {block.text && (
            <p>
              <Inline text={block.text} book={book} />
            </p>
          )}
          {block.items && (
            <ul>
              {block.items.map((t, i) => (
                <li key={i}>
                  <Inline text={t} book={book} />
                </li>
              ))}
            </ul>
          )}
        </Notice>
      );
    case "picture": {
      const shot = shots[block.shot.id];
      return shot ? <Shot shot={shot} alt={block.shot.alt} caption={block.caption} book={book} /> : null;
    }
    case "video":
      return <Video block={block} />;
  }
}

const updatedLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Dublin" });

/** Section headings of a guide, for its "On this page" list. */
export function guideSections(guide: Guide) {
  return guide.blocks.flatMap((b) => (b.type === "heading" ? [{ id: anchorFor(b.text), text: b.text }] : []));
}

/** `book` is the booking site's address, for the guide's links to it (inline.ts). */
export default function GuideView({
  guide,
  shots,
  back,
  book,
}: {
  guide: Guide;
  shots: Record<string, ResolvedShot>;
  back: { href: string; label: string };
  book: string;
}) {
  const sections = guideSections(guide);
  return (
    <article className="guide">
      <p className="guide-back">
        <a href={back.href}>{back.label}</a>
      </p>
      <header className="page-intro">
        <p className="guide-audience">{AUDIENCE_LABEL[guide.audience]}</p>
        <h1>{guide.title}</h1>
        <p className="lede">{guide.summary}</p>
        <p className="meta">Updated {updatedLabel(guide.updated)}</p>
      </header>
      {sections.length > 2 && (
        <nav className="guide-toc" aria-labelledby="toc-title">
          <p id="toc-title" className="label">
            On this page
          </p>
          <ul role="list">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="guide-body">
        {guide.blocks.map((b, i) => (
          <BlockView key={i} block={b} shots={shots} book={book} />
        ))}
      </div>
    </article>
  );
}

/** A list of guides, one card each (help centre and dashboard). */
export function GuideList({ guides, hrefFor }: { guides: Pick<Guide, "slug" | "title" | "summary">[]; hrefFor: (slug: string) => string }) {
  return (
    <ul className="option-list">
      {guides.map((g) => (
        <li key={g.slug}>
          <a className="option" href={hrefFor(g.slug)}>
            <span className="option-main">
              <span className="option-title">{g.title}</span>
              <span className="option-desc">{g.summary}</span>
            </span>
            <Icon name="chevron-right" className="option-chevron" />
          </a>
        </li>
      ))}
    </ul>
  );
}
