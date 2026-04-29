import React from "react";
import LinkifyIt from "linkify-it";

// Auto-linking for post / reply bodies.
//
// linkify-it is a battle-tested URL matcher (handles trailing punctuation,
// parens-in-urls, bare domains like example.com/foo, emails). We use it for
// match positions only and do our own React-node assembly so the link element
// stays under our control:
//   - target="_blank" so the user keeps their place in the app
//   - rel="noopener noreferrer ugc" to prevent tabnabbing AND signal to
//     search engines that user-generated links shouldn't transfer trust
//
// One module-level instance is fine — the matcher is stateless across calls.
const linkify = new LinkifyIt();

function renderLinkifiedString(text: string, keyPrefix: string): React.ReactNode {
  if (!text) return text;
  const matches = linkify.match(text);
  if (!matches || matches.length === 0) return text;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.index > cursor) nodes.push(text.slice(cursor, m.index));
    nodes.push(
      <a
        key={`${keyPrefix}-${i}-${m.index}`}
        href={m.url}
        target="_blank"
        rel="noopener noreferrer ugc"
        className="auto-link"
        onClick={e => e.stopPropagation()}
      >
        {m.text}
      </a>
    );
    cursor = m.lastIndex;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

/**
 * Wrap any URL-shaped substrings in a plain-text body in <a target="_blank">
 * tags. Returns a single React fragment safe to drop into JSX in place of
 * `{body}`. Empty/null bodies pass through unchanged.
 */
export function linkifyText(text: string | null | undefined): React.ReactNode {
  if (!text) return text ?? "";
  return renderLinkifiedString(text, "lnk");
}

/**
 * For render paths that already produce mixed React.ReactNode arrays (e.g.
 * citation-annotated bodies in RepliesList / InlineThreadView), walk the
 * array and linkify only the string entries — JSX elements (citation spans,
 * sup buttons, prompt fragments, etc) pass through untouched.
 */
export function linkifyNodes(nodes: React.ReactNode[]): React.ReactNode[] {
  return nodes.map((node, i) => {
    if (typeof node === "string") {
      return (
        <React.Fragment key={`lnk-frag-${i}`}>
          {renderLinkifiedString(node, `lnk-${i}`)}
        </React.Fragment>
      );
    }
    return node;
  });
}
