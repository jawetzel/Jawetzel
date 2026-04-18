import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Joshua Wetzel — Full-stack developer";

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "linear-gradient(135deg, #fcfcfa 0%, #def7f6 60%, #54d9d3 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#54d9d3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#174543",
              fontWeight: 900,
              fontSize: 30,
            }}
          >
            J
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#152028" }}>
            jawetzel.com
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            color: "#152028",
          }}
        >
          <div
            style={{
              fontSize: 84,
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: "-0.03em",
            }}
          >
            Joshua Wetzel
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 500,
              color: "#206f6b",
              letterSpacing: "-0.02em",
            }}
          >
            Full-stack dev. Modernizing legacy systems.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 18,
            fontSize: 24,
            color: "#4f6472",
          }}
        >
          <span>.NET · Node · Next.js</span>
          <span>·</span>
          <span>Remote-proven</span>
          <span>·</span>
          <span>Baton Rouge, LA</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
