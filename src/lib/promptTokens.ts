import React from "react";

// Shared parser for `[PROMPT:...]` tokens embedded in a thread body or
// preview. Splits the input on every prompt token; each token becomes a
// right-justified <blockquote className="prompt-ref"> (styled in
// theme.ts), and the surrounding text is returned as plain string parts.
//
// Used by both V1 InlineThreadView (expanded body) and V2 friend-room
// surfaces (V2InlineThread expanded body + V2RoomFeed collapsed preview).
// Lifting from V1's local function keeps the prompt rendering identical
// across surfaces — no duplicated regex / blockquote shape.

const PROMPT_TOKEN_RE = /\[PROMPT:([\s\S]*?)\]/g;

export function parsePromptTokens(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(PROMPT_TOKEN_RE.source, "g");
  let keyIdx = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index).trimEnd());
    }
    const promptText = match[1].trim();
    parts.push(
      React.createElement(
        "blockquote",
        { key: `prompt-${keyIdx++}`, className: "prompt-ref" },
        promptText,
      ),
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last).trimStart());
  return parts;
}
