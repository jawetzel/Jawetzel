"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

export function ScalarReference({ specUrl }: { specUrl: string }) {
  return (
    <ApiReferenceReact
      configuration={{
        url: specUrl,
        hideDarkModeToggle: false,
        theme: "default",
        layout: "modern",
      }}
    />
  );
}
