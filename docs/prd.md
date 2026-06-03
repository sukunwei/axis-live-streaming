Take-Home Engineering Assignment
Live Sports Streaming Platform
Issued: Tuesday, June 2, 2026 | Due: Thursday, June 4, 2026 — by 8:00 PM | Time budget:
~48 hours
Overview
This is a fast-paced, open-ended exercise. We are less interested in a feature-complete product and
more interested in how you reason your way to the best workable solution under time pressure. You
should expect to make pragmatic trade-offs, justify them, and ship something that actually runs.
The challenge: build a platform that aggregates and re-delivers live video of sporting events to
viewers in a browser — conceptually similar to how aggregator sites surface many live feeds in one
place (e.g., WorldMonitor for live news channels, or Buffstreams for live game streaming). The
hard part, and the thing we are grading, is stream quality: smooth playback, low latency, fast
channel switching, and graceful behavior when a source degrades.
There is plenty of live content to demonstrate quality with (see “Approved Content Sources” below).
Your Objective
Deliver a working web app where a viewer can open a page, choose from one or more live sports
(or live-event) streams, and watch with the best playback experience you can achieve in the time
available. Optimize relentlessly for the quality of the stream itself.
Approved Content Sources (pick any)
• Live game streams from existing aggregators — e.g., Buffstreams and similar live sports
aggregators. These are the most direct way to demonstrate the platform working against real
live game feeds.
• Live broadcaster pages such as NCAA March Madness Live and other league or tournament live pages, when running.
• Free, offcial live streams from leagues and broadcasters that publish public feeds —
league- or club-operated YouTube Live channels (NFL, F1, NBA G League, MLB and La
Liga free-window broadcasts when running), Red Bull TV’s free live event streams, and free
ad-supported sports channels.
• FAST channels (free ad-supported streaming TV) that carry sports content with
public HLS endpoints — Pluto TV, Tubi, and Xumo Play all run sports channels you can
point a player at.
• Public test and sample live streams — Apple’s sample HLS streams, Mux test assets
(including their persistent live-loop endpoints), Akamai’s live HLS test feeds, and the Big
Buck Bunny / Sintel live loops. Useful as a development harness even if they’re not “real”
sports.
1Requirements
• Live demo. A working, reachable demo we can watch during a short review call (deployed
URL, tunnel, or screen-share of it running locally — your choice, but it must run live).
• At least two sports. Your demo must include live (or live-style) feeds from at least two
different sports, switchable from the same page. We want to see channel switching and ABR
behavior across more than one source.
• GitHub repository. All source code, with a README covering setup, architecture, the
trade-offs you made, and what you’d do next with more time.
• Stream quality first. Prioritize startup time, latency, rebuffering, adaptive bitrate, and
recovery from a flaky source over breadth of features.
• Browser playback. The end experience should work in a standard desktop browser.
Things Worth Thinking About
You are free to choose any stack. Areas where strong candidates tend to differentiate themselves:
• Protocol choice: HLS vs. LL-HLS vs. DASH vs. WebRTC, and why — latency vs. scalability
vs. complexity.
• Ingest & transcoding: ffmpeg, a media server (e.g., MediaMTX, nginx-rtmp, OvenMediaEngine), or a managed API; adaptive bitrate ladders.
• Delivery: packaging, segmenting, caching/CDN, and how you’d scale to many concurrent
viewers.
• Player: hls.js / dash.js / Video.js / Shaka, buffer tuning, ABR behavior, error recovery.
• Resilience: what happens when a source drops, stalls, or changes resolution mid-stream.
API / Service Budget
You may use paid APIs or managed streaming services if they help you ship a better result. We
will reimburse documented costs up to $50 USD. Keep receipts/usage screenshots and note what
you spent in the README. Staying free is completely fine and not penalized.
What to Submit
• Link to the GitHub repository (public, or grant us access).
• Instructions to reach the live demo, plus your availability for a short review call.
• A short note (in the README is fine) on architecture, trade-offs, costs used, and next steps.
How We’ll Evaluate
Criteria What we’re looking for Weight
Stream quality Low latency, fast startup,
minimal rebuffering, clean
ABR, graceful recovery
40%
Problem-solving speed Sound trade-offs made
quickly; pragmatic path to a
working result
25%
Architecture & clarity Sensible design; clear
README and reasoning
20%
2Criteria What we’re looking for Weight
Demo & polish It runs live and is easy to
follow
15%
Questions are welcome — reach out any time before the deadline. Good luck, and have fun with
it.
3