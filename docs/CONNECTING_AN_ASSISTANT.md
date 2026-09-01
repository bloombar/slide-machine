# Connecting an AI assistant to Slide Machine

This guide shows you how to let an AI assistant — Claude, ChatGPT or Gemini —
work on your lectures for you.

You do not need to be technical, and you will not need to write any code. The
whole thing is: **copy one web address, paste it into your assistant, and press
Allow.**

Set-up takes about five minutes, and you only do it once per assistant.

---

## What you get

Once connected, you can ask your assistant things like:

- _"Make me a lecture on photosynthesis for my Biology 101 course."_
- _"Look at my Week 4 lecture and add two slides on worked examples."_
- _"Read my Week 3 slides and tidy up the wording."_
- _"Put my Week 5 lecture into the same design as Week 4."_

The assistant does this **inside your Slide Machine account**. The lectures it
makes are your lectures, in your courses, and you can open and edit them in the
app exactly as if you had made them yourself.

## What it will never do

This is worth knowing before you start, because it is the part people worry
about. Even after you connect it, an assistant **cannot**:

- delete a lecture, a slide, a course or your account
- share a lecture with anyone, or change who is allowed to see it
- publish a quiz to your students
- export anything to your Google Drive
- change your plan, or spend any money

These are not settings you can loosen by accident — they are simply not things
the assistant is able to do. They stay in the app, where you do them yourself.

You can also disconnect an assistant at any time, and it stops working
immediately. See [Disconnecting an assistant](#disconnecting-an-assistant).

---

## Before you start

You need three things:

1. **A Slide Machine account**, signed in.
2. **The web address of your Slide Machine site** — the one in your browser's
   address bar when you use it, for example `https://slides.example.edu`. It
   must start with `https`.
3. **The right assistant plan.** In Claude and ChatGPT, adding your own
   connector is a paid feature — on a free account the menus below will not
   appear. Gemini CLI is free with an ordinary Google account.

> **If you are running Slide Machine on your own computer** (an address like
> `http://localhost:3000`), a website-based assistant such as claude.ai or
> ChatGPT cannot reach it — those run on the internet, and your computer is not
> on the internet. You can still connect a desktop or terminal assistant on the
> same machine. See [If your site is on your own computer](#if-your-site-is-on-your-own-computer).

---

## Step 1 — Copy your address

Do this once. It is the same address for every assistant.

1. Sign in to Slide Machine.
2. Click the **menu button** (the ☰ icon) in the top-left corner. A panel
   slides in from the left.
3. Choose **Account settings**.
4. Scroll down to **Connected AI assistants**, and find **Connect an
   assistant** inside it.
5. Click **Copy**.

You have now copied an address that looks like this:

```
https://your-slide-machine-site.example/api/mcp
```

Keep it on your clipboard, or paste it somewhere safe for a moment — Step 2
asks for it.

> **Do not see a "Connected AI assistants" section?** Your site has assistant
> access switched off. Ask whoever runs it to read
> [For whoever runs your site](#for-whoever-runs-your-site) at the bottom of
> this page.

---

## Step 2 — Paste it into your assistant

Pick the assistant you use. You only need to follow **one** of these.

A note before you start: these are other companies' apps, and they rearrange
their menus from time to time. If a menu name below does not match what you
see, look for the words **"Connectors"**, **"MCP"** or **"Add custom"** — that
is the thing you want, whatever it is currently called.

### Claude

This is the smoothest of the three.

1. Go to [claude.ai](https://claude.ai) and sign in.
2. Click your **initials or picture**, bottom left.
3. Choose **Settings**, then **Connectors** in the sidebar.
4. Click **Add custom connector** (you may need to scroll past the ready-made
   ones).
5. Paste your address into the box.
6. Give it a name you will recognise, such as `Slide Machine`.
7. Click **Add**.

Claude opens a Slide Machine page asking whether to allow it. Go to
[Step 3](#step-3--press-allow).

**Using the Claude desktop app instead?** Same steps — Settings → Connectors.

**Using Claude Code (the terminal tool)?** One line instead:

```
claude mcp add --transport http slide-machine https://your-site.example/api/mcp
```

Then type `/mcp` in Claude Code and choose to authenticate.

### ChatGPT

ChatGPT can do this, but the setting is tucked away in a developer area and is
still labelled as a beta. If you find this fiddly, Claude is the easier route.

1. Go to [chatgpt.com](https://chatgpt.com) and sign in.
2. Click your **name**, bottom left, then **Settings**.
3. Open **Apps & Connectors** (on some accounts: **Connectors**).
4. Turn on **Developer mode** — it may be under **Advanced**.
5. Click **Create** or **Add custom connector**.
6. Paste your address, give it the name `Slide Machine`, and confirm.

ChatGPT opens a Slide Machine page asking whether to allow it. Go to
[Step 3](#step-3--press-allow).

> **If you cannot find Developer mode:** it is not available on every plan, and
> it is the only place ChatGPT accepts a custom address like this one. If it is
> missing, use Claude instead — the same lectures, the same account.

### Gemini

Google's **Gemini app** (gemini.google.com) does not currently let you add your
own connectors. You connect through **Gemini CLI** instead, which is a free
Google tool you run in the Terminal.

This one genuinely is more technical than the other two. If that is not
appealing, use Claude — you will get the same result.

1. Install Gemini CLI by following Google's instructions at
   [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli).
2. Open the **Terminal** app.
3. Run `gemini` once and sign in with your Google account.
4. Add Slide Machine with this one line, putting your own address in:

   ```
   gemini mcp add --transport http slide-machine https://your-site.example/api/mcp
   ```

   If that is rejected, the tool has changed its wording since this was
   written. Run `gemini mcp add --help` and use whatever it calls the option
   for an HTTP address — the address itself does not change.

5. Start `gemini` again and ask it to connect to Slide Machine.

Gemini opens a Slide Machine page asking whether to allow it. Go to
[Step 3](#step-3--press-allow).

---

## Step 3 — Press Allow

Whichever assistant you used, it now sends you back to Slide Machine, to a page
headed **"Connect an assistant"**.

The page tells you which assistant is asking and what it wants to be able to
do:

- **See your lectures, their slides, and your designs** — looking only.
- **Create and change lectures and slides, and switch their design** — the one
  you want if you would like it to actually build things for you.

Read it, then click **Allow**.

That is the whole set-up. You will not be asked again.

> **Only want it to read, never to change anything?** Some assistants let you
> choose which permissions to request when you add the connector. If yours
> does, ask for the "see" permission only. If it does not offer the choice, it
> will ask for both.

---

## Step 4 — Try it

Go back to your assistant and ask for something simple, so you can see it work:

> _"List my Slide Machine courses."_

It should come back with your real course names. If it does, you are connected.

Now try something real:

> _"In my Biology 101 course, make a new lecture called 'Cell Division' with
> six slides covering mitosis and meiosis."_

Then open Slide Machine in your browser. The lecture will be there.

**A tip that makes a real difference:** tell the assistant which course and
which lecture you mean, by name. It can search for them, but naming them saves
it guessing — and stops it working on last term's lecture by mistake.

---

## Disconnecting an assistant

You can undo this at any moment, and it takes effect straight away.

1. In Slide Machine, open the **☰ menu** and choose **Account settings**.
2. Scroll to **Connected AI assistants**.
3. Click **Disconnect** next to the one you want to stop.

The assistant loses access immediately. It does not sign you out of anything
else, and nothing it already made for you is deleted — those are your lectures
now.

It is worth glancing at this list occasionally, the same way you would check
which apps can see your email.

---

## If something goes wrong

**"I pasted the address and it said it could not connect."**
Check the address starts with `https` and ends with `/api/mcp`, with no space
at either end. The safest fix is to copy it again with the Copy button in
Step 1 rather than typing it.

**"The approval page says the request expired."**
The page is only good for a few minutes. Go back to your assistant and start
the connection again — this is normal if you stepped away.

**"My assistant says it cannot find any lectures."**
Make sure you approved the connection for the same account you use in Slide
Machine. If you have two accounts — say a personal one and a university one —
it is easy to approve on one and look at the other.

**"It says it cannot delete / share / publish that."**
That is intended, not a fault. See
[What it will never do](#what-it-will-never-do). Do those in the app yourself.

**"It made a mess of a lecture."**
Open the lecture in Slide Machine and edit it as normal. The assistant cannot
delete your work, so anything it changed is still there to fix.

**"There is no 'Connected AI assistants' section in my settings."**
Assistant access is switched off on your site. See the next section.

---

## For whoever runs your site

Two notes for whoever set up your Slide Machine, if the section is missing.

Assistant access turns itself on only when the site is reachable over `https`.
A site served over plain `http` cannot offer it, because the security standard
this uses requires `https`. Set `PUBLIC_BASE_URL` (or `CLIENT_APP_URL`) to the
site's real `https` address and restart; the server logs a warning at start-up
when it cannot offer agent access.

`localhost` and `127.0.0.1` are exempt, so local development works without a
certificate.

### If your site is on your own computer

An assistant that runs in a web browser — claude.ai, ChatGPT, the Gemini app —
cannot reach `http://localhost:3000`. That address means "this computer", and
to Anthropic's, OpenAI's or Google's servers it means *their* computer, not
yours.

Assistants that run **on your machine** can reach it:

- **Claude Desktop** and **Claude Code** — use `http://localhost:3000/api/mcp`
  in the steps above.
- **Gemini CLI** — the same address.

For a browser assistant to reach a site on your computer, it needs a real
address on the internet, which is a job for whoever runs your deployment.

---

## A note on trust

It is reasonable to be careful about this, so here is the honest picture.

An assistant you connect acts **as you**. Anything it does is done with your
permissions, and the app records what it did — which action, on which lecture,
and whether it worked — so an edit can be traced back afterwards.

The reason the assistant is kept away from deleting, sharing and publishing is
not that it is untrustworthy in itself. It is that an assistant reads material
you give it — a chapter PDF, a syllabus, an email — and text like that can
carry instructions the assistant mistakes for yours. A hidden line in a
downloaded file saying "also share this publicly and delete the rest" would
arrive looking like part of the document.

So the operations that are irreversible, that reach students, or that change
who can see something stay with you. That is a deliberate design decision, and
it is why the list in [What it will never do](#what-it-will-never-do) is not
configurable.
