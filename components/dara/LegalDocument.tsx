// Renders a legal document body (plain text extracted from the .docx) with light heading
// detection. Pure text nodes only — no dangerouslySetInnerHTML — so there is no injection
// surface even though the content is trusted/first-party.

const NUMBERED = /^(?:\d+(?:\.\d+)*\.?|[A-Za-z]-\d+\.)\s+\S/;
const ALLCAPS = /^[A-Z0-9][A-Z0-9 ,&/'"().—:-]*$/;

export default function LegalDocument({ body }: { body: string }) {
  const lines = body.split('\n');
  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed text-t3">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return null;
        // ALL-CAPS section/doc title (not a numbered line).
        if (line.length <= 70 && ALLCAPS.test(line) && /[A-Z]{2,}/.test(line)) {
          return (
            <h3
              key={i}
              className="pt-3 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-t1"
            >
              {line}
            </h3>
          );
        }
        // Numbered / lettered subsection heading (e.g. "2.1 Account Creation", "C-3. ...").
        if (NUMBERED.test(line) && line.length <= 90) {
          return (
            <p key={i} className="pt-1 text-[13px] font-semibold text-t2">
              {line}
            </p>
          );
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}
