import { describe, expect, it } from "vitest";
import { deviceFrom, isBot } from "../scan-tracking";

/**
 * Bot filtering is the difference between a number worth acting on and one
 * that just looks encouraging. Paste an /e/ link into Slack and it fetches
 * immediately — counting that as a scan inflates the only metric anyone will
 * use to judge whether the print run was worth repeating.
 */
describe("isBot", () => {
  it("rejects the link previewers that hit shared URLs", () => {
    for (const ua of [
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "WhatsApp/2.23",
      "TelegramBot (like TwitterBot)",
      "facebookexternalhit/1.1",
      "Discordbot/2.0",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "HeadlessChrome/120.0.0.0",
    ]) {
      expect(isBot(ua), ua).toBe(true);
    }
  });

  it("treats a missing user-agent as a script, not a person", () => {
    expect(isBot(null)).toBe(true);
    expect(isBot("")).toBe(true);
  });

  it("lets real phones and browsers through", () => {
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    ]) {
      expect(isBot(ua), ua).toBe(false);
    }
  });
});

describe("deviceFrom", () => {
  it("separates phone-in-hand from desk browsing", () => {
    expect(deviceFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("mobile");
    expect(deviceFrom("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile")).toBe("mobile");
    expect(deviceFrom("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120")).toBe("desktop");
    expect(deviceFrom(null)).toBe("unknown");
  });

  it("counts an iPad as mobile — it is still someone holding the book", () => {
    expect(deviceFrom("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("mobile");
  });
});
