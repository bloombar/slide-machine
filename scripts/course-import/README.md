# Course import

Turns a directory of [remark.js](https://github.com/gnab/remark) lecture
sources into a project full of pre-saved lecture decks, together with the
pictures and documents those lectures link to as each lecture's seed material.

The knowledge.kitchen course notes are the reference source, but nothing here
is specific to them: point the importer at any directory of files in the format
below and it will build the matching project.

```bash
npm run course:import -- \
  --dir ~/knowledge-kitchen/content/courses/software-engineering/slides \
  --project "Software Engineering" \
  --base-url http://localhost:3000 \
  --email instructor@example.edu
```

`--help` lists every flag. `--dry-run` converts and reports without writing
anything; `--out <dir>` writes the converted slides as JSON for review.

Re-running is safe — a lecture whose title is already in the project is
skipped, and material already attached to a lecture is left alone — so an
interrupted import resumes by running it again.

`--replace` rebuilds instead of resuming: a lecture already in the project is
deleted and imported afresh, which is what picks up a change to the source or
to the importer itself. The delete cascades to that lecture's slides and seed
material and is a tombstone rather than an erasure, so the app can restore it.
Lectures the run is not importing are untouched.

## The source format

A lecture is one markdown file. The importer reads the subset of remark.js the
course notes use:

| Syntax                                                                                               | Meaning                                    |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `---` YAML block at the top of the file                                                              | Lecture frontmatter                        |
| `---` on its own line                                                                                | Slide break                                |
| `--` on its own line                                                                                 | Incremental reveal — merged into its slide |
| `name:` / `class:` / `template:` / `layout:` / `count:` / `background-image:` at the head of a slide | Slide properties                           |

Only `title:` and `description:` are read from the frontmatter: the title names
the lecture, the description becomes its seed notes.

A separator inside a fenced code block is never treated as markup, so a `---`
in a YAML sample or a `--` comment in a SQL listing will not split a slide.

Within a slide, these become slide content:

| In the source                   | Becomes                                               |
| ------------------------------- | ----------------------------------------------------- |
| First slide                     | `title`, with its subtitle as the caption             |
| A heading with nothing under it | `section`                                             |
| Prose                           | `content`                                             |
| Points                          | `list`                                                |
| Prose and points                | `content-list`                                        |
| A picture beside prose          | `two-column`                                          |
| A picture alone                 | `image-heavy` (alt text as caption)                   |
| A block quote                   | `quote`, with any trailing attribution as the caption |
| A fenced listing                | `code`, in a real code slot with its language         |

Two details are worth knowing:

- **Overflow splits, it never truncates.** These are lectures somebody wrote
  and will teach from, so content past a layout's budget moves onto a
  continuation slide. Budgets are read from the project's own template, so a
  custom template paginates to its real limits.
- **A listing needs a code slot.** The slide renderer draws only inline
  markdown in a text box ([SlideMarkdown](../../client/src/components/SlideMarkdown.tsx)),
  so a fenced block put into prose would arrive as a run-together paragraph.
  Each listing gets the `code` layout instead — which is also why the importer
  builds slides one at a time rather than through `deck.import`, whose YAML
  carries no code, maths or table slots.

Slides on a layout with a picture box that no source picture filled — the
continuation pages of a split two-column slide, for instance — have search
terms mined from their own words and a picture sourced for them in the
background (IMG-1).

A slide with no heading and no `template:` continues the section it follows, as
it reads on the page. Tables have no slot in any built-in layout and become
bullets — the grid is lost, the content is not. Speaker narration is not
imported: slides arrive with no transcript, and playback narrates from their
content instead.

## Link structures

Paths in the source are written for the _page_ a lecture is published at —
`/<course>/slides/<lecture>/` — not for the markdown file, which is one
directory higher. That is why a picture beside the lecture file is linked as
`../images/x.png`: the `../` climbs out of the page's directory, and looks like
one `../` too many next to the file itself.

All of these are understood, both for the URLs written onto slides and for
finding the file on disk:

| Written in the source                           | The file it means                   |
| ----------------------------------------------- | ----------------------------------- |
| `../images/x.png`                               | `slides/images/x.png`               |
| `../assets/<lecture>/x.png`                     | `slides/assets/<lecture>/x.png`     |
| `images/x.png`                                  | `slides/<lecture>/images/x.png`     |
| `/content/courses/<course>/slides/images/x.png` | `slides/images/x.png`               |
| `/content/courses/<other>/assets/x.png`         | the sibling course's `assets/x.png` |
| `{{ site.baseurl }}/slides/images/x.pdf`        | `slides/images/x.pdf`               |
| `https://example.com/x.pdf`                     | Left as a link; not downloaded      |

Readings are tried most-correct first and the first that exists on disk wins,
so a source that is inconsistent about `../` still resolves. A site-absolute
path is matched by its tail against this course _and_ against the directory the
courses share, so a lecture that borrows a picture from a sibling course finds
it; the longest tail that matches wins, so the course the path names beats a
same-named file in the course being imported. A query string or
`#anchor` after the filename is ignored. Anything with no file extension —
`../version-control-systems`, `../uml-diagrams#use-cases` — is a link to
another lecture, not a file, and is left alone.

Slide URLs are made absolute against the published site so a picture keeps
working once it lives on a slide; override the site with `--site-base` and
`--course-path` when the sources live somewhere else.

## Seed material

Every picture and document a lecture links to is uploaded as that lecture's
seed material ([SEED-1](../../docs/SPEC.md#seed-1-document-seeding)), so generation during the lecture
draws on what the instructor already gathered. Pass `--no-seed-material` to
import the slides alone.

**Labelling is the point.** An uploaded picture is offered to generation by its
caption and the keywords derived from that caption, so each upload is captioned
with everything that says what it is about — the alt text or link label, the
slide heading it illustrates, the lecture title, and the filename, with
repeated words dropped:

```
Waterfall process lifecycles — Process models —
What is Software Engineering — software lifecycles waterfall
```

Captions are applied after the server finishes extracting the file, because
extraction saves the asset and would otherwise overwrite them; `--material-timeout`
(default 30s) caps that wait. A hand-written caption is never overwritten by
the server's own vision captioning.

**The slide shows the uploaded copy.** A picture box is first given the URL
the source's own path points at on the published site, but that site is built
from its own revision of the notes — a picture the local source names may not
be served there at all, and a box holding a dead URL shows nothing. Once the
file is uploaded, the box is repointed at that copy.

Only what the upload route accepts is sent — PDF, DOCX, TXT/MD, PNG, JPEG
and WebP, up to 20 MB. Everything else linked from the lecture is reported at the end of
the run with the reason it was left behind: linked off-site, unsupported
format, over the size limit, or not found on disk. Uploads count against the
account's import allowance, so `--dry-run` lists exactly what would be sent
and how much it comes to.

## Tests

```bash
npm run test:scripts
```
