# Slides → Markdown → slides

A note on the round-trip idea: converting an imported presentation to Markdown,
then converting that Markdown back into slides, so an import matches what Google
Slides displays.

This is a write-up of what the idea buys, what it cannot buy, and what the
importer does today — which is the useful half of it.

## The idea

Read a deck, write each slide out as Markdown, and rebuild the deck from that
Markdown. Markdown is a format everything understands, so the reasoning goes:
if the text survives the trip, the slide does.

## What it gets right

The half that works is **inside a text box**.

A box on a real lecture slide is rarely one thing. It is a sentence of context,
then the points that follow from it, then a closing line — with a word in bold
here and a link there. The importer used to give a box one kind: any bulleted
paragraph made the whole box a list, so the prose around it came back as bullets
nobody wrote, and the emphasis was dropped on the way, because a bullet is a
plain string.

Markdown is exactly the right shape for that, and the app already reads it:
`SlideMarkdown` renders paragraphs, lists, bold, italic, code and links in any
multi-line text slot. So a box written as Markdown comes back looking like the
box it came from — without a new content model, a new renderer, or a second way
for a slot to hold text.

**This is implemented.** `server/src/import/markdown.ts` writes a box out as
Markdown when it holds more than one kind of paragraph, or when it holds a link.
It carries:

- prose and bullets mixed in one box, each as itself
- nested points, at the depth the author set them
- numbered points as numbered points
- bold and italic — but only where the emphasis is *partial*, since a heading
  that is bold from end to end is the design speaking, not the author
- links, with the styled phrase inside the link rather than the other way round

## What it cannot get right

The other half is **everything that is not text**, and Markdown has no way to
say any of it:

| A slide has | Markdown has |
| --- | --- |
| A box at a position, of a size | nothing |
| A typeface, a size, a weight, a colour | nothing |
| Two columns, a sidebar, a caption under a picture | nothing |
| A logo in the corner of every slide | nothing |
| A table with columns of different widths | a table with equal columns |
| A picture, cropped, at a position | a link to an image |

So a deck round-tripped through Markdown comes back as a stack of prose. It
would look *less* like the original, not more — the geometry is the design, and
the design is most of what makes a deck recognisable.

This is why the importer's five passes are about geometry
(`read-slides` → `candidate` → `consolidate` → `build-template`), and why only
one pass — `semantics` — involves the model at all, and then only for names and
sentences, never for a position.

## Where that leaves it

The two halves are complementary, and the importer uses both:

- **Geometry** is read from the source and kept as measured — boxes, sizes,
  colours, typefaces, logos. This is what the template becomes.
- **What a box holds** is written as Markdown when the box holds something
  Markdown can express better than a plain string.

Put the other way: Markdown is the right model for *a box's contents* and the
wrong model for *a slide*. The round-trip idea is worth having for the first and
would lose the deck on the second.

## If the question comes back

The thing worth stealing from the idea, and not yet done, is Markdown as an
**export** format — a lecture written out as a Markdown file, one section per
slide, for reading, diffing, or feeding to something else. That is a different
feature from import fidelity and does not trade anything away, because nobody
expects a Markdown file to look like a slide.
