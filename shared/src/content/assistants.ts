/**
 * "Connecting an AI assistant" — the public how-to for pointing Claude or
 * ChatGPT at a Slide Machine account, linked from About.
 *
 * A plain constant like ABOUT: it describes the software rather than the
 * party running it, so there is nothing here for a deployment to configure.
 *
 * It covers the hosted site only. Connecting an assistant to a Slide Machine
 * you are running on your own computer is a developer concern and stays in
 * docs/CONNECTING_AN_ASSISTANT.md, which is the fuller version of this page.
 */
import type { StaticDocument } from './document'

export const ASSISTANTS: StaticDocument = {
  title: 'Connecting an AI assistant',
  summary: 'Build and edit your lectures from Claude or ChatGPT.',
  body: `
You can let an AI assistant you already use — Claude or ChatGPT — work on your
lectures for you. Once it is connected you can simply ask:

- _"Make me a lecture on photosynthesis for my Biology 101 course."_
- _"Look at my Week 4 lecture and add two slides on worked examples."_
- _"Put my Week 5 lecture into the same design as Week 4."_

The assistant works **inside your own Slide Machine account**. The lectures it
makes are your lectures, in your courses, and you can open and edit them in the
app exactly as if you had made them yourself.

You do not need to write any code. The whole thing is: copy one web address,
paste it into your assistant, and press **Allow**. It takes about five minutes,
and you only do it once per assistant.

The connection uses **MCP**, an open standard for letting an assistant work
with an outside app. You do not need to know anything more about it than its
name — which is what the menus in Claude and ChatGPT call this.

## What it will never do

This is the part people worry about, so it is worth saying up front. Even after
you connect it, an assistant **cannot**:

- delete a lecture, a slide, a course or your account
- share a lecture with anyone, or change who is allowed to see it
- publish a quiz to your students
- export anything to your Google Drive
- change your plan, or spend any money

These are not settings you can loosen by accident — they are simply not things
the assistant is able to do. They stay in the app, where you do them yourself.

## Step 1 — Copy your address

Do this once. It is the same address for every assistant.

1. Sign in to Slide Machine.
2. Click the **menu button** (the ☰ icon) in the top-left corner.
3. Choose **Account settings**.
4. Scroll down to **Connected AI assistants**, and find **Connect an
   assistant** inside it.
5. Click **Copy**.

You have now copied an address ending in \`/api/mcp\`. Keep it on your
clipboard — Step 2 asks for it.

## Step 2 — Paste it into your assistant

Follow **one** of these, for the assistant you use. Adding your own connector
is a paid feature in both Claude and ChatGPT, so on a free account the menus
below will not appear.

These are other companies' apps and they rearrange their menus from time to
time. If a name below does not match what you see, look for the words
**"Connectors"**, **"MCP"** or **"Add custom"** — that is the thing you want,
whatever it is currently called.

### Claude

This is the smoother of the two.

1. Go to [claude.ai](https://claude.ai) and sign in.
2. Click your **initials or picture**, bottom left.
3. Choose **Settings**, then **Connectors** in the sidebar.
4. Click **Add custom connector** — you may need to scroll past the ready-made
   ones.
5. Paste your address into the box.
6. Give it a name you will recognise, such as \`Slide Machine\`.
7. Click **Add**.

The Claude desktop app is the same: **Settings → Connectors**.

### ChatGPT

ChatGPT can do this, but the setting is tucked away in a developer area. If you
find it fiddly, Claude is the easier route.

1. Go to [chatgpt.com](https://chatgpt.com) and sign in.
2. Click your **name**, bottom left, then **Settings**.
3. Open **Plugins** — the same area was called **Connectors**, and then **Apps
   & Connectors**, on earlier versions, so it may still carry one of those
   names.
4. Open **Developer mode**. It is the only place ChatGPT accepts a custom
   address like this one, and it may sit under **Advanced**.
5. Click **Create** or **Add custom connector**.
6. Paste your address, name it \`Slide Machine\`, and confirm.

If Developer mode is not there at all, it is not offered on your plan. Use
Claude instead — the same lectures, the same account.

## Step 3 — Press Allow

Whichever assistant you used, it now sends you back to Slide Machine, to a page
headed **"Connect an assistant"**. The page names the assistant that is asking
and what it wants to be able to do:

- **See your lectures, their slides, and your designs** — looking only.
- **Create and change lectures and slides, and switch their design** — the one
  you want if you would like it to actually build things for you.

Read it, then click **Allow**. That is the whole set-up, and you will not be
asked again.

## Step 4 — Try it

Go back to your assistant and ask for something small, so you can see it work:

> _"List my Slide Machine courses."_

It should come back with your real course names. Then try something real:

> _"In my Biology 101 course, make a new lecture called 'Cell Division' with
> six slides covering mitosis and meiosis."_

Open Slide Machine in your browser and the lecture will be there.

**A tip that makes a real difference:** name the course and the lecture you
mean. The assistant can search for them, but naming them saves it guessing —
and stops it working on last term's lecture by mistake.

## Disconnecting an assistant

You can undo this at any moment, and it takes effect straight away.

1. Open the **☰ menu** and choose **Account settings**.
2. Scroll to **Connected AI assistants**.
3. Click **Disconnect** next to the one you want to stop.

The assistant loses access immediately. Nothing it already made for you is
deleted — those are your lectures now. It is worth glancing at this list
occasionally, the same way you would check which apps can see your email.

## If something goes wrong

**"I pasted the address and it said it could not connect."** Check it starts
with \`https\` and ends with \`/api/mcp\`, with no space at either end. Copying
it again with the **Copy** button is safer than typing it.

**"The approval page says the request expired."** It is only good for a few
minutes. Go back to your assistant and start the connection again.

**"My assistant says it cannot find any lectures."** Make sure you approved the
connection while signed in to the account you actually use. If you have two —
a personal one and a university one — it is easy to approve on one and look at
the other.

**"It says it cannot delete / share / publish that."** That is intended, not a
fault — see "What it will never do" above. Do those in the app yourself.

**"There is no 'Connected AI assistants' section in my settings."** Assistant
access is switched off on the site you are using. Whoever runs it can turn it
on.

## A note on trust

It is reasonable to be careful about this, so here is the honest picture.

An assistant you connect acts **as you**. Anything it does is done with your
permissions, and the app records what it did — which action, on which lecture,
and whether it worked — so an edit can be traced back afterwards.

The reason it is kept away from deleting, sharing and publishing is not that it
is untrustworthy in itself. It is that an assistant reads material you give it
— a chapter PDF, a syllabus, an email — and text like that can carry
instructions the assistant mistakes for yours. A hidden line in a downloaded
file saying "also share this publicly and delete the rest" would arrive looking
like part of the document.

So the operations that are irreversible, that reach students, or that change
who can see something stay with you. That is deliberate, and it is why that
list is not configurable.

Anything else, the [feedback form](/feedback) reaches us directly.
`.trim(),
}
