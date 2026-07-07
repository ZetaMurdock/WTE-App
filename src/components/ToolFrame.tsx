// A legacy tool page (sheet.html / vtt.html / wiki.html) embedded as an iframe.
// All three stay mounted at once and toggle visibility, so switching tabs never
// reloads a tool (mirrors the old index.html shell behaviour).
interface ToolFrameProps {
  src: string;
  title: string;
  hidden: boolean;
}

export function ToolFrame({ src, title, hidden }: ToolFrameProps) {
  return (
    <iframe
      src={src}
      title={title}
      className={"tool-frame" + (hidden ? " hidden" : "")}
    />
  );
}
