---
type: llm
focus: trace
weight: 1
---
Judge only the visible text of the HTML pages written with the Write tool: the words a reader sees in the browser. Ignore tags, attribute names, CSS, JavaScript, the skill's own instructions and the assistant's reasoning elsewhere in the transcript. The reader is a product owner. The terms in the user's own request are the reader's words and need no definition: device agent, DNS-over-HTTPS, resolver, public DNS, fallback, exception list, retry, domains. Judge only the terms the assistant introduces beyond those. PASS only if the visible text uses plain words: any technical term or abbreviation is defined in place or replaced, and nothing reads like internal jargon. FAIL example: 'each run is a full session up to the plan gate'. FAIL if an abbreviation or term of art appears without a definition the first time it is used.
