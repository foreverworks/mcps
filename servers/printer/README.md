# <img src="icons/icon.svg" width="36" height="36" alt="Printer and scanner icon"> Printer and scanner MCP server

Print documents, scan pages and check the paper and toner of a network
printer from your AI assistant, over IPP Everywhere (printing and status) and
eSCL (scanning), the standards AirPrint and Mopria devices speak. Each page
goes out as a lossless raster rendered here and, once you calibrate the
printer, corrected so it prints the greys you sent. Nothing moves money, but
`print`, `scan` and `calibration_sheet` act on paper in someone's home or
office, so your client asks you before each call.

**You need** an IPP Everywhere printer on your network (most AirPrint and
Mopria printers are), with an eSCL flatbed for scanning and calibrating; its
address; and, if it signs its own TLS certificate, that certificate's
fingerprint. Printing a PDF needs poppler where the server runs. There is no
account and no key. Prints are A4, grey and one-sided.

## What you can ask

- "Is the printer ready, and how much toner is left?"
- "Print pages 1 to 3 of lease-agreement.pdf, two copies."
- "Show me how invoice-0042.pdf would print, without printing it."
- "Scan what's on the glass as a 300 dpi PDF."
- "Calibrate the printer. Print the sheet, and I'll put it on the scanner."
- "Cancel the job that's printing now."

## Install

<!-- install:begin -->
> [!NOTE]
> Printer and scanner is one of this repository's [extras](../../README.md#extras), which run from a clone and are not published to npm, the MCP Registry or as desktop bundles. Run it on Node 22.19 or newer.

With Claude Code:

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add printer -e PRINTER_URI="<Printer address>" -- node "$PWD/servers/printer/dist/index.js"
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON, with the full path of `servers/printer/dist/index.js` in your clone:

```json
{
  "mcpServers": {
    "printer": {
      "command": "node",
      "args": ["<path to the clone>/servers/printer/dist/index.js"],
      "env": {
        "PRINTER_URI": "<Printer address>"
      }
    }
  }
}
```

The commands above set only what is required; [Configuration](#configuration) has the rest. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

PDFs are rendered with poppler's `pdfinfo` and `pdftoppm`, found on `PATH`:
install `poppler-utils` on Debian and Ubuntu, or `brew install poppler` on
macOS. PNG and JPEG are decoded in-process.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `PRINTER_URI` | yes | The printer's IPP URI: `ipps://<host>:443/ipp/print` (TLS; many printers serve it on 443, though RFC 7472's default is 631) or `ipp://<host>/ipp/print` (plain, port 631). An `https://` or `http://` URL works too. |
| `PRINTER_TLS_SHA256` | for TLS, usually | The device certificate's SHA-256 fingerprint (64 hex digits, colons allowed). Set, only that certificate is accepted; unset, only one that verifies normally, which a printer's own rarely does. |
| `PRINTER_ESCL_URL` | no | The scanner's eSCL root. Default: `/eSCL` on the same host's web server, over `https://` when `PRINTER_URI` is TLS. |
| `PRINTER_STATE_DIR` | no | Where `calibration.json` (and the one it replaced) is kept; the default is in [docs/configuration.md](../../docs/configuration.md). |
| `PRINTER_OUTBOX_DIR` | no | Where dry runs (`print/`, `calibration/`) and scans (`scan/`) are written, mode 0640. Default: `outbox` in the state folder. |

With none of these set, the server still starts, and a tool that needs the
device answers a `config` error naming the variable. `print` and
`calibration_sheet` with `dry_run` need no device.

Files to print or load go in by path, from the folders `MCP_FILE_ROOTS` names
(over stdio, by default, the roots your client shares). A deployment that sets
`MCP_EGRESS_ALLOW` must allow the printer's host, and a sandbox that closes
private networks (systemd's `IPAddressDeny`) must open its address. The
variables every server shares are in
[docs/configuration.md](../../docs/configuration.md).

### Getting the certificate fingerprint

Printers usually sign their own certificates, so the server accepts one by
its fingerprint. A plain `ipp://` address, or a certificate that verifies
normally, needs none.

1. Set `PRINTER_URI` and leave `PRINTER_TLS_SHA256` unset.
2. Ask your assistant for the printer's `status`. It answers a `tls` error
   carrying the fingerprint the printer showed.
3. Compare it with the one on the printer's own web page (its network or
   security settings), or print it from a shell on the same network:

   ```bash
   echo | openssl s_client -connect <host>:443 2>/dev/null | openssl x509 -noout -fingerprint -sha256
   ```

4. Set `PRINTER_TLS_SHA256` to it, and restart the server.

## First run

1. Ask for the printer's `status`: whether it accepts jobs, its supplies and
   paper, the scanner's state, and whether a calibration is loaded. Each part
   answers for itself, so a scanner that does not answer does not hide the
   printer.
2. Try a dry run ("show me how this would print"): it writes the raster and a
   preview of each page to the outbox, and prints nothing.

### Calibrating

Without a calibration, the printer prints the document's greys its own way.
Calibrating takes two sheets:

1. Ask for a calibration sheet. `calibration_sheet` prints one uncorrected
   page of grey patches under a name (default `cal-<date>-<time>`) that its
   layout is made from, so keep it.
2. Lay the sheet face down and flat on the glass, its top edge against the
   glass's starting corner (either way up works), and `scan` it at 300 dpi,
   grey, as a PDF.
3. `measure_calibration`, given the sheet's name and the path `scan`
   answered, adds the measured patches to the calibration and says how well
   the model predicted them before and after.
4. Repeat with a second sheet printed at another time. Two sheets give the
   model what it needs; more narrow it.

From then on `print` corrects every page (`correction: false` sends the greys
as they are), and `calibration` sums up the model in a few numbers.

## Tools

**read** changes nothing; write changes a print job, the calibration or the
outbox; **write** in bold puts paper through the printer or uses the scanner,
and is confirmed with you before every call ([below](#confirmation)).

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether the server works: ok unless a setting, the device's certificate or the calibration is wrong. A printer that is off or busy is reported (`reachable: false`), not a failure. |
| `status` | read | The printer's state and reasons in plain words, whether it accepts jobs, supplies with levels, firmware, paper and formats; the scanner's state and recent jobs; whether a calibration is loaded. |
| `job` | read | One print job by number with its state and reasons, or the current and recently completed jobs (10 of each by default, up to 50). |
| `calibration` | read | The loaded calibration: patches per sheet, how closely the fitted model matches each sheet, the tone response and the left-right profile in a few numbers. |
| `print` | **write** | Prints a PDF, PNG or JPEG on A4 at 600 dpi in grey as lossless PWG raster, corrected when calibrated, and waits for the job to finish. 1 to 20 copies, collated, at most 100 sheets a call; `pages` picks PDF pages (`"1-3,5"`). `dry_run` writes the raster and previews to the outbox instead. |
| `scan` | **write** | Scans the glass to a PDF or JPEG in the outbox: 50 to 1200 dpi (default 300), grey or colour, A4, Letter or the whole glass, checked first against what the scanner offers. |
| `calibration_sheet` | **write** | Prints the calibration sheet uncorrected (342 grey patches, black and paper references, marks to find it in a scan); `dry_run` writes a preview instead. |
| `cancel_job` | write | Cancels an unfinished print job; pages already printed stay printed. |
| `measure_calibration` | write | Measures a scan of a calibration sheet (askew or upside down is fine) and adds its patches to the calibration, with how well the model predicted them before and after. `add: false` only measures; `replace: true` measures a sheet again. |
| `load_calibration` | write | Replaces the calibration with a file of measured patches, checked and fitted first; the previous one is kept. |

### Confirmation

The three bold tools are confirmed like a payment, though nothing is paid:
your client asks you before each call (Claude Code does, in every permission
mode). With `MCP_CONFIRM=elicit` the server asks you itself, in one line
computed from the arguments, for example:

```
printer: print lease-agreement.pdf, pages 1-3, 2 copies, correction as calibrated
printer: scan what is on the glass: a4, 300 dpi, grey, pdf
printer: print a calibration sheet named cal-20261022-0930, one page, uncorrected
```

A dry run says `prepare, without printing,` instead of `print`. How each
client asks is in
[docs/security.md](../../docs/security.md#money-and-confirmation).

## Troubleshooting

**`config`.** A setting is missing or malformed; the message names it
(`PRINTER_URI`, `PRINTER_ESCL_URL`, `PRINTER_TLS_SHA256`, or the printer's
host missing from `MCP_EGRESS_ALLOW`). Set it and restart the server.

**`tls`.** The certificate is not the pinned one, or none is pinned and it
does not verify. The error carries the fingerprint the device showed: if the
printer's own web page shows the same, set `PRINTER_TLS_SHA256` to it. A
certificate that changed unexpectedly is a reason to stop and look.

**`unreachable`.** The printer or scanner did not answer: check that it is on
and that this machine has a route to it, then ask for `status`. If this
happened while a document was being sent, the printer may have taken it: look
with `job` before printing again.

**`busy`.** The printer is stopped or not accepting jobs (`status` says why:
paper, a jam, a cover), or the scanner is not idle. Fix the cause, or wait for
the scan in progress, then try again.

**`printer`.** The printer refused the request; its own message says why, and
`status` shows what it reports.

**`print` answers `finished: false`.** The printer was still working when the
wait ran out, or the server lost sight of the job. Follow it with `job` and
the answer's `job_id` before printing again.

**`render`.** The file is not a complete PDF, PNG or JPEG, or poppler is not
installed ([Install](#install)).

**`calibration`.** Correction was asked for and no calibration is loaded (call
with `correction: false`, or calibrate); or a scan could not be measured, and
the message says what to fix: scan the whole sheet, flat and face down with
the lid closed, at 150 dpi or more, under the name it was printed with.

**`drift`.** The device answered unlike its protocol. Note its model and
firmware (`status`) and report it.

## How it works

### Printing: the page as the printer's own raster

- **Rendered here, at the printer's resolution.** `pdftoppm` renders each PDF
  page at 600 dpi in grey with antialiasing off, so text and vector edges stay
  solid black on white (a grey fringe would be one more tone to dither). An A4
  page comes out a pixel larger than the sheet's 4960 x 7015 dots and is
  cropped, never resampled, so every glyph keeps its pixels. A larger page is
  rendered at the lower resolution that fits, a smaller one prints at its true
  size, and a landscape page is turned a quarter. An image has no size on
  paper, so it is fitted to the page (shrunk by area averaging, grown by
  repeating pixels).
- **Sent as PWG raster** (PWG 5102.4), 8-bit grey (`sgray_8`), the lossless
  format every IPP Everywhere printer takes: no driver, no JPEG, no second
  scaling. Copies are the pages repeated in the stream, collated: every
  printer honours that, unlike the `copies` attribute. Each page is encoded as
  soon as it is ready and streamed from disk, so a long document never sits in
  memory whole.
- **Followed to the end.** Nothing is rendered until the printer accepts
  jobs. `print` then follows the job until the printer calls it completed,
  aborted or canceled, for up to a minute plus 15 s a sheet (at most 10
  minutes).

### Correction: what this printer prints for what it is sent

A laser printer does not print the grey it is sent. The lightest greys print
far lighter or not at all, the response rises in steps through the light
tones, and mid tones print darker at the side edges of the page than in the
middle, the same on sheets printed at different times. A test printer was
measured with its own scanner, which repeated itself to well under a point,
and a sheet scanned turned round showed the same profile, so the profile is
the printer's.

The calibration is every measured patch, `[sheet, sent %, x mm, printed %]`.
The model fitted to it is `printed = R(sent) + D(x) * w(R)`: R the tone
response, isotonic (pool adjacent violators), pinned at 0 and 100; D(x) the
left-right profile, a degree-4 polynomial across the page; w how much of D a
tone takes (all of it from 20% to 80%, tapering to none at paper and black).
R and D are fitted alternately, six rounds. For each 0.5 mm band of the page
(2 mm bands showed as steps on paper), a 256-entry table solves
`c + D(x) w(c) = t` for the tone c that must print and sends `R^-1(c)`.
Anything under 3% stays paper white: the printer cannot print it faithfully,
and a speck is worse than none. The correction is applied to the raster at
print time only; the document is never changed. On the test printer, it
roughly halved the left-right spread of a grey band and removed the dark edge;
what remains varies patch by patch, worst in the light tones where the
response comes in steps.

**The calibration sheet** holds 342 patches, each tone from 2% to 98% six or
seven times at shuffled places, printed uncorrected. Every column starts and
ends with a solid black and a bare paper patch, and no grey touches a black one
(grey next to black prints darker). `measure_calibration` finds the page by its
four corner marks and an orientation mark (askew, off the corner or upside down
measures the same), fits an affine map from the layout to the scan, takes a
trimmed mean over each patch's inner half, and turns it into coverage between
the paper and the black of its own column, since a scanner's light is not even
down the glass.

**Parity.** The model, tables and raster were first built and validated on
paper in Python and numpy. This port computes the same doubles where numpy's
order of operations decides them (pairwise summation in a mean, `interp`'s
exact-knot rule, Python's round-half-even), and solves the least squares by
Householder QR where numpy calls LAPACK. On a measured calibration, all 420 x
256 table entries equal the reference's, and the validation sheet's raster is
byte-identical, made several times faster. `test/correction.test.ts` holds
the tables to the reference's for an invented calibration, `test/pwg.test.ts`
the encoder to the reference encoder's bytes, and `scripts/parity.ts` repeats
the comparison for any calibration and document.

### The device

- **TLS is pinned** ([Configuration](#configuration)), and the pin is checked
  on every connection, after the handshake and before a request byte is
  written. IPP over TLS and eSCL usually share the device's port 443, so one
  port reaches everything.
- **The configured address is the truth.** The `printer-uri` sent is the
  configured one: printers echo whatever host they were reached by in their
  own URIs (through a tunnel, a loopback address), so those say nothing about
  where they are. For the same reason only the path of an eSCL job's
  `Location` is kept.
- **eSCL:** a ScanSettings document is POSTed to `ScanJobs`, and the scan is
  fetched from the job's `NextDocument`, which answers 503 until it is ready.
  Some scanners send bytes after a JPEG's end marker; the file is cut at the
  marker (found by walking the segments, so an embedded thumbnail's own end
  marker does not count), and the result says how many bytes were removed.

`npx tsx scripts/smoke.ts` drives the built server against the configured
device. It only reads and prepares (`status`, `calibration`, and a dry run of
the file `SMOKE_FILE` names, when set) unless given `--print` or `--scan`,
which print that file once or scan the glass once: pass them only when someone
at the printer expects it.

## Limitations

- **One device per server**, A4 only, one-sided, grey. Colour printing,
  duplex and other paper sizes are not modelled.
- **Calibration needs a flatbed scanner** (the multifunction's own or
  another) and trusts it as the measuring instrument. Check it once: scan one
  sheet twice, and once turned round; the patches should agree to a few tenths
  of a point.
- **What the correction does not fix:** grey right next to solid black prints
  darker for its first few millimetres, small grey text prints lighter than
  its grey (use a darker grey, or bold), and small isolated patches print a
  few points lighter. These depend on the neighbourhood, not on the tone or
  the position.
- **Status is what the device reports.** A supply level of "some remaining"
  or "unknown" is passed on as such.

## Other servers for printers and scanners

Searched 2026-10-21. No printer vendor publishes one. The community servers
found:

- **`mcp-printer`** (steveclarke, npm, TypeScript) and
  **`timeverse-printer-mcp`** (PyPI) print through CUPS, the Windows spooler
  or pyipp.
- **`print-mcp`** turns Markdown into a PDF and prints it through CUPS.
- **`claude-printer-mcp`** prints text on a Mac.
- **`scanner-mcp`** and **`scan-mcp`** scan through eSCL, SANE or WIA.

All of them hand the printer a document and let a driver or the printer decide
how its greys come out, and none checks the device's certificate. This one
renders the page itself, corrects it from measurements of what this printer
actually prints, and sends exactly those pixels as lossless PWG raster, so
text stays as sharp as the printer can make it and a 20% grey prints as 20%.
It talks to one configured device and pins its TLS certificate.
