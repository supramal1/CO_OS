import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Speak to Charlie · Charlie Oscar OS",
};

export default function SpeakToCharlieLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
