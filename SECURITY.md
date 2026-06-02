# Security Policy

SEO Video Slicer is a **local desktop tool**, maintained by a single person
([@ehukaimedia](https://github.com/ehukaimedia)). This document explains what is
supported, how to report a vulnerability, and — importantly — the threat model
the project is designed around, so you can judge whether a given concern is in
scope.

## Supported Versions

This is an alpha, single-maintainer project. Security fixes land on `main`; there
is no back-porting to older snapshots. Run the latest.

| Version                | Supported          |
| ---------------------- | ------------------ |
| `main` (latest)        | :white_check_mark: |
| Older / forked builds  | :x:                |

If you are running an older checkout, please update to the latest `main` before
reporting — the issue may already be fixed.

## Reporting a Vulnerability

**Please do _not_ open a public GitHub issue for a security vulnerability.** A
public issue discloses the problem before there is a fix.

Instead, use one of these private channels:

1. **Preferred — GitHub private vulnerability reporting.** If it is enabled for
   this repo, go to the **Security** tab → **Report a vulnerability** (the
   "Private vulnerability reporting" feature). This keeps the report private and
   threaded with the maintainer.
2. **Email.** If private reporting is not available, email
   **ehukaimedia@gmail.com** with a subject line that starts with
   `[SECURITY] seo-video-slicer`.

### What to include

The more of this you can provide, the faster it can be triaged:

- A clear description of the issue and **why it is a security problem** (what
  boundary it crosses — see the threat model below).
- **Steps to reproduce**, ideally minimal: the exact request, file, or input.
- **Impact**: what an attacker gains (e.g. read a file outside the data dir,
  run a command, crash the process).
- Affected component/path (`backend/app/...`, `package-contract/...`, the
  frontend, etc.) and the commit / version you tested.
- Your environment: OS, Python version, Node version, and how you launched the
  app (`make run`, `start.sh`, `start.command`).
- Any proof-of-concept, logs, or screenshots.

### What to expect

This is a best-effort, solo-maintained project, so please set expectations
accordingly:

- **Acknowledgement:** typically within a few days.
- **Triage & fix:** as soon as is practical after acknowledgement, prioritized by
  severity. There is no formal SLA.
- **Disclosure:** please allow a reasonable window to ship a fix before any
  public disclosure. Credit will gladly be given in the fix/release notes if you
  want it.

There is **no bug bounty** — reports are handled out of goodwill to keep the tool
safe for its users.

## Threat Model

Understanding the intended deployment is essential to judging what is and is not a
vulnerability.

### What this app is

SEO Video Slicer is a **LOCAL desktop application with no authentication**. It is
designed to run on **`localhost`, your LAN, or your private tailnet** — for a
single trusted operator (you) processing your own videos. There is no login, no
user accounts, no authorization layer, and none is planned: auth is intentionally
out of scope for a single-user local tool.

> **Do NOT expose this app to the public internet.**
> Because there is no authentication, anyone who can reach the HTTP port can use
> the API: upload videos, trigger ffmpeg/OpenCV processing, and read generated
> artifacts under the data directory. Binding it to a public interface, or
> port-forwarding it through a router, turns an intentional convenience into a
> real exposure. If you need remote access, put it behind your own
> VPN/tailnet/SSH tunnel and reverse proxy with authentication — that is your
> responsibility, not the app's.

### Boundaries the code _does_ enforce

Even though it is a trusted-operator tool, the backend still defends the obvious
filesystem boundary:

- **Path containment on `/data` and the frontend static routes.** Requests that
  resolve a filesystem path verify it stays under the intended root using
  `Path.relative_to` (see `_path_is_within` / `path.relative_to(root)` in
  `backend/app/main.py`). A request whose resolved path escapes the root (e.g.
  via `..` traversal) is rejected rather than served. Reports of a working path
  traversal that reads or writes outside the data/static roots are **in scope**
  and welcome.
- **Uploads are processed locally.** Uploaded videos never leave your machine.
  They are handed to **ffmpeg** (trim/encode) and **OpenCV** (frame extraction,
  baseline inpaint) running locally. Upload content-type is checked, and files
  are written under the job's data directory. Note that ffmpeg and OpenCV are
  large native dependencies; parsing untrusted media inherently carries some risk
  in those libraries — keep them updated, and only feed the tool media you are
  willing to process.

### The optional premium erase — what it downloads (and when)

The default "erase" path is **baseline** OpenCV inpaint (`cv2.inpaint`,
Navier-Stokes) and **downloads nothing**.

The **premium** neural erase (LaMa / IOPaint) is strictly opt-in:

- The backend **never auto-installs** torch/IOPaint. Availability is a pure import
  probe (`premium_available()` in `backend/app/erase.py`) that installs nothing.
- A model is fetched **only if you have installed IOPaint yourself** (via
  `backend/requirements-premium.txt`) and the premium tier actually runs. That model
  download is performed by IOPaint, from its own source, on first use — outside
  the default flow.
- If IOPaint is not installed, premium **silently falls back to baseline** and
  never reaches out to the network.

So: **the default install and default code path make no model downloads and no
external requests.** The only network fetch for a model is one you opt into by
installing the premium extra.

### Generated packages are self-contained

The exported WebP animation package (frames + `index.html` + `manifest.json` +
`verify.mjs`) is designed to **open and animate with no server, no build step,
and zero external requests**. The frozen package contract
(`package-contract/CONTRACT.md`) and its `verify.mjs` gates (G1–G7) are what keep
that promise; CI enforces that `build_package.mjs` and `verify.mjs` stay
byte-identical on the shared fingerprint recipe.

### Out of scope

The following are **not** considered vulnerabilities in this project:

- Lack of authentication / authorization (by design — it is a single-user local
  tool; see the warning above).
- Any issue that only arises because the app was **deliberately exposed to an
  untrusted network or the public internet**, contrary to the guidance here.
- Denial of service from feeding the tool deliberately huge or malformed media on
  your own machine (it is your machine and your input).
- Theoretical concerns with no demonstrated impact on the documented local
  deployment.

When in doubt, report it privately anyway — over-reporting is fine, and triage
will sort out scope.
