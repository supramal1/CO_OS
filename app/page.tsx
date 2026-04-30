import { redirect } from "next/navigation";
import { CropMarks } from "@/components/crop-marks";
import { SignInButton } from "@/components/sign-in-button";
import { auth } from "@/auth";
import { DEFAULT_LANDING } from "@/lib/modules";

const REMOTE_ENDPOINTS = [
  {
    label: "Cornerstone",
    url:
      process.env.CORNERSTONE_API_URL ??
      "https://cornerstone-api-lymgtgeena-nw.a.run.app",
  },
  {
    label: "Cookbook",
    url:
      process.env.COOKBOOK_MCP_URL ??
      "https://co-cookbook-mcp-lymgtgeena-nw.a.run.app",
  },
];

export default async function SplashPage() {
  const session = await auth();
  if (session?.user?.email) {
    redirect(DEFAULT_LANDING);
  }
  return (
    <div className="co-splash">
      <CropMarks />

      <div className="co-splash__ambient" aria-hidden>
        <span />
        <span />
        <span />
      </div>

      <main className="co-splash__main">
        <section className="co-splash__copy">
          <h1>Charlie Oscar OS</h1>
          <p>
            The operating system for Charlie Oscar. Sign in with your work account to continue.
          </p>
        </section>

        <section className="co-splash__stage" aria-label="Charlie Oscar OS">
          <div className="co-cube-wrap" aria-hidden>
            <div className="co-cube-shadow" />
            <div className="co-cube">
              {["front", "back", "right", "left", "top", "bottom"].map((face) => (
                <div className={`co-cube__face co-cube__face--${face}`} key={face}>
                  <span className="co-cube__mark">CO</span>
                  <span className="co-cube__grid" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <SignInButton />

        <dl className="co-splash__remotes" aria-label="Remote service URLs">
          {REMOTE_ENDPOINTS.map((endpoint) => (
            <div className="co-splash__remote" key={endpoint.label}>
              <dt>{endpoint.label}</dt>
              <dd>
                <a href={endpoint.url} target="_blank" rel="noreferrer">
                  {endpoint.url.replace(/^https?:\/\//, "")}
                </a>
              </dd>
            </div>
          ))}
        </dl>
      </main>

      <span className="co-splash__version">
        CO-OS / V1.0
      </span>
    </div>
  );
}
