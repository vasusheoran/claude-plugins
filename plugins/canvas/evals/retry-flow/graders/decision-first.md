---
type: llm
focus: trace
weight: 1
---
Judge from the transcript, in the Write tool input (the HTML page content). PASS only if the first screen of the main decision page (the first visible content in the HTML body) states the decision being asked AND names the assistant's pick, before any background, context, or explanation. FAIL if background, a title-only banner plus history, or a description of the problem comes first, or if no pick is named.
