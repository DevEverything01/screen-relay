"use client";

import { useTheme } from "next-themes";

type DiagramProps = {
  name: string;
  title: string;
  aspectRatio?: string;
};

/** Embeds `/diagrams/<name>/index.html` in a lazy iframe and passes the site theme as `?theme=`. */
export const Diagram = ({
  name,
  title,
  aspectRatio = "1124 / 452",
}: DiagramProps) => {
  const { resolvedTheme } = useTheme();
  const query = resolvedTheme === "light" || resolvedTheme === "dark" ? `?theme=${resolvedTheme}` : "";

  return (
    <iframe
      className="my-6 block w-full rounded-lg border-0"
      loading="lazy"
      src={`/diagrams/${name}/index.html${query}`}
      style={{ aspectRatio }}
      title={title}
    />
  );
};
