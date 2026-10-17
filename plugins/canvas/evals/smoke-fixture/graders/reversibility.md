---
type: llm
focus: trace
weight: 1
---
Judge from the transcript, in the Write tool input (the HTML page content). PASS only if every decision card on the main decision page (the first page, not the details page; one undo line per card covers its options) says what it costs to undo, in plain words (for example 'easy to undo later' or 'hard to undo once X ships'). FAIL if any decision lacks an undo-cost statement.
