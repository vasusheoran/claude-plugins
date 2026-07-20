---
name: anti-ai-writing
description: Rules for writing prose that doesn't read as AI-generated, distilled from Wikipedia's "Signs of AI writing" catalogue. Load BEFORE writing any prose a human will read — docs, ADRs, plan/canvas artifacts, READMEs, PR descriptions, marketing or UI copy, reports — or when asked to "de-AI" existing text. Also invoked by /foreman for all prose it produces.
---

# Anti-AI writing

Wikipedia editors catalogued the tells that make text read as machine-generated
(Wikipedia:Signs of AI writing). Each tell below is something reviewers actively
scan for. The common thread: AI text performs *writing-about-writing* — it
signals importance, comprehensiveness, and balance instead of stating facts.
The fix is always the same: delete the performance, keep the information.

Apply this to every sentence you produce for human readers. When editing
existing text, fix only the tells — don't rewrite voice or restructure content
that's fine.

## 1. Banned vocabulary

These words cluster in AI text and almost never carry information. Replace or
delete on sight (in prose — quoting someone is fine):

- **Significance inflation**: stands as, serves as, is a testament to,
  underscores, highlights, pivotal, crucial, vital, key (as adjective),
  landmark, watershed, turning point, enduring legacy, transformative
- **Fake texture**: tapestry, landscape (metaphorical), interplay, intricate,
  intricacies, nuanced, multifaceted, rich (metaphorical), vibrant, dynamic
- **Fake diligence**: delve, meticulous(ly), comprehensive, robust, seamless,
  leverage (verb), utilize, foster(ing), garner, bolster, showcase, boast
- **Connective filler**: additionally, moreover, furthermore, notably,
  importantly, it's worth noting, in essence, ultimately, overall (as opener)
- **2024–25 era tells**: align with, enhance, streamline, elevate, empower,
  unlock, harness, drive innovation, evolving landscape

Test: if deleting the word loses no information, it was decoration.

## 2. Banned constructions

- **Copula avoidance.** "The API serves as the entry point" → "The API is the
  entry point." Write *is*, *are*, *has*. Also: "features/offers/boasts X" → "has X".
- **Negative parallelism.** "It's not just X, it's Y" / "not only … but also" /
  "This isn't about X — it's about Y." State Y directly; there was no
  misconception to correct.
- **Rule of three.** "fast, reliable, and secure" — triads of adjectives or
  phrases signal padding, not analysis. Name the one property that matters, or
  give each claim its own supported sentence.
- **Participle-phrase commentary.** A fact followed by ", -ing" analysis:
  "handles 40k qps, cementing its role as the core of the stack." The clause
  after the comma is unsupported opinion. Delete it or make it a claim with
  evidence.
- **Elegant variation.** Calling the same thing "the service", "the platform",
  "the solution", "the tool" in successive sentences. Pick one name and repeat
  it; repetition is how technical prose stays unambiguous.
- **Vague attribution.** "Experts argue", "observers note", "industry reports
  suggest", "many consider". Name the source or drop the claim.
- **Editorializing frames.** "It's important to note that X" → "X."
  "Interestingly, X" → "X."

## 3. Banned tone

- **Puffery.** No press-release adjectives for your own work: groundbreaking,
  cutting-edge, state-of-the-art, world-class, best-in-class, renowned,
  "nestled in", "in the heart of". Describe what the thing does; let the
  reader judge it.
- **Significance inflation.** Don't tie mundane facts to grand narratives
  ("reflecting the broader shift toward…", "highlighting the growing
  importance of…"). A config change is a config change.
- **Canned balance.** The "Despite its strengths, X faces challenges…"
  paragraph, and "Challenges and Future Directions" / "Future Outlook"
  sections. If there's a real limitation, state it concretely with its
  consequence; don't perform even-handedness.
- **Summary endings.** No "In conclusion", "In summary", "Ultimately", no
  final paragraph restating what was already said. Technical docs end when the
  information ends.

## 4. Formatting tells

- **Bold.** Only for genuine navigation anchors (a term the reader scans for).
  Never bold-for-emphasis across a paragraph, never **Term:** at the start of
  every bullet in a list. A list where every item is "**Header:** sentence" is
  the single strongest AI tell in the catalogue — write prose or drop the headers.
- **Bullets.** Lists are for genuinely enumerable items (steps, options,
  flags). If the bullets are full sentences with connective logic between
  them, it's a paragraph wearing a costume — write the paragraph.
- **Em dashes.** Ration them. More than one per paragraph reads as generated;
  most can become a comma, colon, or two sentences.
- **Headings.** Sentence case, never Title Case ("Impact of technology", not
  "Impact of Technology and Digitalization"). Don't skip heading levels. No
  horizontal rules as section decoration.
- **No emoji** in prose, headings, or as list markers (UI copy with an
  established emoji convention is the only exception).
- **Straight quotes.** `"` and `'`, never curly `“ ” ’` in code-adjacent or
  markdown text.
- **No tool artifacts.** Grep for and remove chatbot residue before shipping:
  `contentReference`, `oaicite`, `oai_citation`, `turn0search`, `[cite:`,
  `attributableIndex`, `utm_source=` in URLs, stray `+1` after links.

## 5. Structure

- Lead with the point. First sentence answers "what is this / what changed /
  what should I do" — not context-setting throat-clearing.
- One idea per sentence. If a sentence has two commas and an em dash, split it.
- Cut the last paragraph if it summarizes. Cut the first if it's preamble.
- Don't restate a section's content in a mini-summary after its heading.
- Never fabricate citations, DOIs, page numbers, or links. A book cite needs a
  page number; a URL must have been fetched and seen. No source → say so.

## 6. Self-edit pass

Before delivering any prose, run one pass over your own draft:

1. Search it for section-1 vocabulary and section-2 constructions; fix every hit.
2. Count em dashes and bolded phrases; cut to the ration.
3. Read the first and last paragraph — delete them if they're preamble/summary.
4. Check every list: would this be better as prose? Every **Header:** bullet: earned?
5. Check every claim of importance: is there a concrete fact behind it? If
   not, delete the claim, keep the fact.

What survives should be shorter, plainer, and denser than the draft. That's
the point — human technical writing is irregular, specific, and unafraid of
repeating a noun.
