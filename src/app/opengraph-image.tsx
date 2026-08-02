import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Joshua Wetzel — Software Consultant";

// the JW monogram, inlined so the OG render needs no network fetch.
// Paths mirror public/logo/jw-mark.svg.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4.5 8.5 89.5 43" fill="none"><g stroke="#174543" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M28 12v22c0 8.5-6 13.5-13.5 12C11 45.4 9 43.4 8 41"/><path d="M40 12l9.5 36 10.5-25 10.5 25L80 12"/><path d="M19 12h9M40 12h9M71 12h9"/></g><circle cx="90" cy="24" r="4" fill="#f1ae27"/></svg>`;
const MARK_SRC = `data:image/svg+xml;base64,${btoa(MARK)}`;

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
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK_SRC} width={87} height={42} alt="JW" />
          <div style={{ fontSize: 28, fontWeight: 700, color: "#174543" }}>
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
            Software Consultant. Legacy modernization.
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
